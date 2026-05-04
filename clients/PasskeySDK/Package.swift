// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PasskeySDK",
    platforms: [
        .iOS(.v26),
        .macOS(.v26),
    ],
    products: [
        .library(
            name: "PasskeySDK",
            targets: ["PasskeySDK"]
        ),
    ],
    targets: [
        .target(
            name: "PasskeySDK",
            path: "Sources/PasskeySDK"
        ),
        .testTarget(
            name: "PasskeySDKTests",
            dependencies: ["PasskeySDK"],
            path: "Tests/PasskeySDKTests"
        ),
    ]
)
