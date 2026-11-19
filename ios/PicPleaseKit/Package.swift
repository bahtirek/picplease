// swift-tools-version: 6.0
// PicPleaseKit holds everything except the app entry point: core/ now, requester/ and helper/ later.
// No third-party dependencies (docs/mobile/decisions.md).
import PackageDescription

let package = Package(
    name: "PicPleaseKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "PicPleaseCore", targets: ["PicPleaseCore"])
    ],
    targets: [
        .target(name: "PicPleaseCore"),
        .testTarget(name: "PicPleaseCoreTests", dependencies: ["PicPleaseCore"]),
    ]
)
