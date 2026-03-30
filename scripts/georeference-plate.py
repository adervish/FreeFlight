#!/usr/bin/env python3
"""
Georeference an FAA approach plate using Gemini Vision + known fix coordinates.

Usage: python3 scripts/georeference-plate.py <airport_ident> <plate_pdf_name>
Example: python3 scripts/georeference-plate.py O69 06838R29.PDF

Process:
1. Download plate PDF, convert to PNG
2. Send to Gemini Vision to identify fixes and their pixel positions
3. Look up fix coordinates from CIFP data
4. Solve affine transformation (pixel → lat/lon)
5. Output corner coordinates for map overlay
"""
import sys, os, json, base64, subprocess, urllib.request, math
import numpy as np
from pathlib import Path

GEMINI_API_KEY = "AIzaSyA8MNl8TXciX6QrgHfWO3pMcjnFXqwDpjE"
CIFP_PATH = "/tmp/cifp/FAACIFP18"
API_BASE = "https://freeflight.bentboolean.com"

def download_plate(pdf_name, out_pdf, out_png):
    """Download plate PDF and convert to PNG."""
    url = f"https://aeronav.faa.gov/d-tpp/2603/{pdf_name}"
    print(f"Downloading {url}...")
    urllib.request.urlretrieve(url, out_pdf)
    subprocess.run(["sips", "-s", "format", "png", out_pdf, "--out", out_png, "-Z", "2048"],
                   capture_output=True)
    # Get actual image dimensions
    result = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", out_png],
                           capture_output=True, text=True)
    w = int([l for l in result.stdout.split('\n') if 'pixelWidth' in l][0].split()[-1])
    h = int([l for l in result.stdout.split('\n') if 'pixelHeight' in l][0].split()[-1])
    print(f"Image: {w}x{h}")
    return w, h

def parse_cifp_fixes(airport_ident):
    """Extract fix coordinates from CIFP for this airport."""
    fixes = {}
    with open(CIFP_PATH) as f:
        for line in f:
            if not line.startswith(f"SUSAP {airport_ident:4s}"):
                continue
            # Airport reference point (A record)
            if line[12] == "A" and airport_ident in line[13:18]:
                coords = parse_cifp_coords(line[32:51])
                if coords:
                    fixes[airport_ident] = coords
            # Fix definitions (C records)
            elif line[12] == "C":
                ident = line[13:18].strip()
                coords = parse_cifp_coords(line[32:51])
                if coords and ident:
                    fixes[ident] = coords
    return fixes

def parse_cifp_coords(s):
    """Parse CIFP lat/lon string like N38152806W122361917."""
    if len(s) < 19:
        return None
    try:
        lat_str, lon_str = s[:9], s[9:]
        lat_sign = -1 if lat_str[0] == "S" else 1
        lat = lat_sign * (int(lat_str[1:3]) + int(lat_str[3:5])/60 + int(lat_str[5:9])/100/3600)
        lon_sign = -1 if lon_str[0] == "W" else 1
        lon = lon_sign * (int(lon_str[1:4]) + int(lon_str[4:6])/60 + int(lon_str[6:10])/100/3600)
        if abs(lat) <= 90 and abs(lon) <= 180:
            return (lat, lon)
    except:
        pass
    return None

def gemini_identify_fixes(png_path, img_w, img_h, known_fixes):
    """Use Gemini Vision to find fix positions on the plate image."""
    with open(png_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    fix_list = ", ".join(known_fixes.keys())

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": "image/png", "data": img_b64}},
            {"text": f"""This is an FAA instrument approach plate. The image is {img_w}x{img_h} pixels.

I know these fixes appear on this plate's PLAN VIEW (the map section): {fix_list}

Also identify the AIRPORT symbol position.

For each fix, find its EXACT position — look for the small triangle symbol (▽ or △) next to the fix name. Give me the pixel coordinates of the TRIANGLE SYMBOL (not the text label).

For the airport, find the runway symbol.

Be extremely precise with pixel coordinates. Return ONLY JSON:
{{"points": [{{"name": "FIXNAME", "px": 500, "py": 300}}, ...]}}"""}
        ]}],
        "generationConfig": {"temperature": 0.0}
    }

    req = urllib.request.Request(url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})

    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())

    text = result["candidates"][0]["content"]["parts"][0]["text"]
    # Extract JSON from response
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]

    return json.loads(text)

def solve_affine(pixel_points, geo_points):
    """
    Solve affine transformation from pixel coords to geographic coords.

    [lat]   [a b c] [px]
    [lon] = [d e f] [py]
                    [1 ]

    Need at least 3 point correspondences.
    """
    n = len(pixel_points)
    if n < 3:
        raise ValueError(f"Need at least 3 matched points, got {n}")

    # Build the system: A * params = b
    A = np.zeros((2*n, 6))
    b = np.zeros(2*n)

    for i, ((px, py), (lat, lon)) in enumerate(zip(pixel_points, geo_points)):
        A[2*i]   = [px, py, 1, 0, 0, 0]
        A[2*i+1] = [0, 0, 0, px, py, 1]
        b[2*i]   = lat
        b[2*i+1] = lon

    # Least squares solution
    params, residuals, _, _ = np.linalg.lstsq(A, b, rcond=None)
    a, bb, c, d, e, f = params

    return params, residuals

def pixel_to_geo(params, px, py):
    """Convert pixel coordinates to lat/lon using affine params."""
    a, b, c, d, e, f = params
    lat = a * px + b * py + c
    lon = d * px + e * py + f
    return lat, lon

def main():
    airport = sys.argv[1] if len(sys.argv) > 1 else "O69"
    pdf_name = sys.argv[2] if len(sys.argv) > 2 else "06838R29.PDF"

    out_dir = Path("/tmp/georef")
    out_dir.mkdir(exist_ok=True)
    out_pdf = out_dir / f"{airport}_plate.pdf"
    out_png = out_dir / f"{airport}_plate.png"

    # Step 1: Download and convert
    img_w, img_h = download_plate(pdf_name, str(out_pdf), str(out_png))

    # Step 2: Get known fix coordinates from CIFP
    print(f"\nParsing CIFP for {airport}...")
    known_fixes = parse_cifp_fixes(airport)
    print(f"Found {len(known_fixes)} fixes: {', '.join(known_fixes.keys())}")
    for name, (lat, lon) in known_fixes.items():
        print(f"  {name:8s} {lat:.6f} {lon:.6f}")

    # Step 3: Use Gemini to find pixel positions
    print(f"\nAsking Gemini to locate fixes on plate...")
    gemini_result = gemini_identify_fixes(str(out_png), img_w, img_h, known_fixes)
    print(f"Gemini found {len(gemini_result['points'])} points:")
    for p in gemini_result["points"]:
        print(f"  {p['name']:8s} px=({p['px']}, {p['py']})")

    # Step 4: Match Gemini points with known coordinates
    pixel_points = []
    geo_points = []
    matched = []

    for p in gemini_result["points"]:
        name = p["name"].upper().strip()
        if name in known_fixes:
            pixel_points.append((p["px"], p["py"]))
            geo_points.append(known_fixes[name])
            matched.append(name)

    print(f"\nMatched {len(matched)} points: {', '.join(matched)}")

    if len(matched) < 3:
        print("ERROR: Need at least 3 matched points for affine transform")
        sys.exit(1)

    # Step 5: Solve affine transformation
    params, residuals = solve_affine(pixel_points, geo_points)
    print(f"\nAffine parameters: {params}")
    if len(residuals) > 0:
        print(f"Residual error: {residuals}")

    # Verify: check error on matched points
    print("\nVerification (matched points):")
    for i, name in enumerate(matched):
        pred_lat, pred_lon = pixel_to_geo(params, pixel_points[i][0], pixel_points[i][1])
        act_lat, act_lon = geo_points[i]
        err_lat = abs(pred_lat - act_lat) * 111000  # meters
        err_lon = abs(pred_lon - act_lon) * 111000 * math.cos(math.radians(act_lat))
        print(f"  {name:8s} predicted=({pred_lat:.6f}, {pred_lon:.6f}) actual=({act_lat:.6f}, {act_lon:.6f}) err={math.sqrt(err_lat**2+err_lon**2):.0f}m")

    # Step 6: Compute corner coordinates
    corners = {
        "topLeft":     pixel_to_geo(params, 0, 0),
        "topRight":    pixel_to_geo(params, img_w, 0),
        "bottomLeft":  pixel_to_geo(params, 0, img_h),
        "bottomRight": pixel_to_geo(params, img_w, img_h),
    }

    print(f"\n=== GEOREFERENCED CORNERS ===")
    print(f"Image: {img_w}x{img_h}")
    for name, (lat, lon) in corners.items():
        print(f"  {name:12s} {lat:.6f} {lon:.6f}")

    # Output JSON for use in overlay
    output = {
        "airport": airport,
        "plate": pdf_name,
        "image": str(out_png),
        "imageWidth": img_w,
        "imageHeight": img_h,
        "corners": {k: {"lat": v[0], "lon": v[1]} for k, v in corners.items()},
        "affineParams": params.tolist(),
        "matchedPoints": len(matched),
        "fixes": {name: {"lat": known_fixes[name][0], "lon": known_fixes[name][1]} for name in matched},
    }

    out_json = out_dir / f"{airport}_georef.json"
    with open(out_json, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nSaved to {out_json}")

if __name__ == "__main__":
    main()
