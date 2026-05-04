import Foundation

extension Data {
    /// Encode as base64url: standard base64 with `-` for `+`, `_` for `/`,
    /// and trailing `=` padding stripped.
    public func base64URLEncodedString() -> String {
        let standard = base64EncodedString()
        var out = standard.replacingOccurrences(of: "+", with: "-")
        out = out.replacingOccurrences(of: "/", with: "_")
        out = out.replacingOccurrences(of: "=", with: "")
        return out
    }

    /// Decode a base64url string. Accepts both padded and unpadded inputs.
    /// Returns nil if the input contains characters outside the base64url alphabet.
    public init?(base64URLEncoded: String) {
        var standard = base64URLEncoded.replacingOccurrences(of: "-", with: "+")
        standard = standard.replacingOccurrences(of: "_", with: "/")
        let padding = (4 - standard.count % 4) % 4
        standard.append(String(repeating: "=", count: padding))
        guard let data = Data(base64Encoded: standard) else { return nil }
        self = data
    }
}
