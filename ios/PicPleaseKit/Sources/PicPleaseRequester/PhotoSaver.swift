import Foundation
import Photos
import UIKit

public enum PhotoPermission: Sendable, Equatable {
    case notDetermined
    case granted
    case denied
}

/// Camera roll access. Saving needs add-only access (asked at the first save); Remove needs full access,
/// asked the first time Remove is tapped (docs/mobile/decisions.md).
public protocol PhotoSaving: Sendable {
    func permissionStatus() -> PhotoPermission
    func requestPermission() async -> PhotoPermission
    /// Saves the image file; returns the asset's local identifier.
    func save(_ file: URL) async throws -> String
    /// Deletes an asset the app saved. iOS shows its own confirmation.
    func delete(_ assetId: String) async throws
    @MainActor func openPhotosApp()
}

public struct PhotoAccessDenied: Error {}

public struct PhotoSaver: PhotoSaving {
    public init() {}

    public func permissionStatus() -> PhotoPermission {
        Self.map(PHPhotoLibrary.authorizationStatus(for: .addOnly))
    }

    public func requestPermission() async -> PhotoPermission {
        Self.map(await PHPhotoLibrary.requestAuthorization(for: .addOnly))
    }

    public func save(_ file: URL) async throws -> String {
        var assetId: String?
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .photo, fileURL: file, options: nil)
            assetId = request.placeholderForCreatedAsset?.localIdentifier
        }
        guard let assetId else { throw CocoaError(.fileWriteUnknown) }
        return assetId
    }

    public func delete(_ assetId: String) async throws {
        var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined {
            status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        }
        guard status == .authorized || status == .limited else { throw PhotoAccessDenied() }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
        guard assets.count > 0 else { return }
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetChangeRequest.deleteAssets(assets)
        }
    }

    @MainActor public func openPhotosApp() {
        if let url = URL(string: "photos-redirect://") {
            UIApplication.shared.open(url)
        }
    }

    private static func map(_ status: PHAuthorizationStatus) -> PhotoPermission {
        switch status {
        case .authorized, .limited: .granted
        case .notDetermined: .notDetermined
        default: .denied
        }
    }
}
