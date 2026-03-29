const API = {
  async getPlanes(tail) {
    const params = tail ? "?tail=" + encodeURIComponent(tail) : "";
    const res = await fetch("/api/planes" + params);
    return res.json();
  },
  async getPlaneFlights(tail) {
    const res = await fetch("/api/planes/" + encodeURIComponent(tail) + "/flights");
    return res.json();
  },
  async getTrack(flightId) {
    const res = await fetch("/api/tracks/" + encodeURIComponent(flightId));
    return res.json();
  },
  async getDailyStats(tail) {
    const params = tail ? "?tail=" + encodeURIComponent(tail) : "";
    const res = await fetch("/api/stats/daily" + params);
    return res.json();
  },
};
