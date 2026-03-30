import Foundation
import CryptoKit

/// Caches remote files locally with daily freshness checks using content hashes.
actor FileCache {
    static let shared = FileCache()

    private let cacheDir: URL
    private let metadataFile: URL
    private var metadata: [String: CachedFileMeta] = [:]

    struct CachedFileMeta: Codable {
        let hash: String
        let lastChecked: Date
        let size: Int
    }

    private init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        cacheDir = docs.appendingPathComponent("FileCache", isDirectory: true)
        metadataFile = cacheDir.appendingPathComponent("metadata.json")
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        loadMetadata()
    }

    /// Get cached data for a URL, checking for updates at most once per day.
    /// Returns cached data immediately if available, fetches in background if stale.
    func getData(for urlString: String, maxAge: TimeInterval = 86400) async -> Data? {
        let key = cacheKey(for: urlString)
        let localFile = cacheDir.appendingPathComponent(key)

        // If we have a cached file, return it
        let cachedData = try? Data(contentsOf: localFile)
        let meta = metadata[key]

        // If cache exists and was checked recently, return it
        if let cachedData, let meta,
           Date().timeIntervalSince(meta.lastChecked) < maxAge {
            return cachedData
        }

        // Fetch fresh copy
        do {
            let freshData = try await fetchAndCache(urlString: urlString, key: key, localFile: localFile, existingHash: meta?.hash)
            return freshData
        } catch {
            // Network error — return cached data if we have it
            if let cachedData {
                print("FileCache: network error for \(urlString), using cached version")
                return cachedData
            }
            print("FileCache: failed to load \(urlString): \(error)")
            return nil
        }
    }

    private func fetchAndCache(urlString: String, key: String, localFile: URL, existingHash: String?) async throws -> Data {
        guard let url = URL(string: urlString) else { throw URLError(.badURL) }

        let (data, _) = try await URLSession.shared.data(from: url)
        let hash = sha256(data)

        if hash != existingHash {
            // Content changed — save new version
            try data.write(to: localFile)
            print("FileCache: updated \(urlString) (\(data.count / 1024)KB)")
        } else {
            print("FileCache: \(urlString) unchanged")
        }

        // Update metadata
        metadata[key] = CachedFileMeta(hash: hash, lastChecked: Date(), size: data.count)
        saveMetadata()

        return (hash != existingHash) ? data : (try Data(contentsOf: localFile))
    }

    /// Manually store data for a URL key (used when data is assembled client-side)
    func store(data: Data, for urlString: String) {
        let key = cacheKey(for: urlString)
        let localFile = cacheDir.appendingPathComponent(key)
        try? data.write(to: localFile)
        metadata[key] = CachedFileMeta(hash: sha256(data), lastChecked: Date(), size: data.count)
        saveMetadata()
        print("FileCache: stored \(urlString) (\(data.count / 1024)KB)")
    }

    // MARK: - Helpers

    private func cacheKey(for url: String) -> String {
        let hash = Insecure.MD5.hash(data: Data(url.utf8))
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private func sha256(_ data: Data) -> String {
        let hash = SHA256.hash(data: data)
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private func loadMetadata() {
        guard let data = try? Data(contentsOf: metadataFile),
              let decoded = try? JSONDecoder().decode([String: CachedFileMeta].self, from: data) else {
            return
        }
        metadata = decoded
    }

    private func saveMetadata() {
        guard let data = try? JSONEncoder().encode(metadata) else { return }
        try? data.write(to: metadataFile)
    }
}
