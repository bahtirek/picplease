// swift-tools-version: 6.0
// PicPleaseKit holds everything except the app entry point: core/ and requester/ now, helper/ later.
// No third-party dependencies (docs/mobile/decisions.md).
import PackageDescription

let package = Package(
    name: "PicPleaseKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "PicPleaseCore", targets: ["PicPleaseCore"]),
        .library(name: "PicPleaseRequester", targets: ["PicPleaseRequester"]),
    ],
    targets: [
        .target(name: "PicPleaseCore"),
        .target(name: "PicPleaseRequester", dependencies: ["PicPleaseCore"]),
        .testTarget(name: "PicPleaseCoreTests", dependencies: ["PicPleaseCore"]),
        .testTarget(name: "PicPleaseRequesterTests", dependencies: ["PicPleaseRequester", "PicPleaseCore"]),
    ]
)
