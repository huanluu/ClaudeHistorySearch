// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ClaudeHistoryShared",
    platforms: [
        .iOS(.v17),
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "ClaudeHistoryShared",
            targets: ["ClaudeHistoryShared"]),
    ],
    targets: [
        .target(
            name: "ClaudeHistoryShared"),
        .testTarget(
            name: "ClaudeHistorySharedTests",
            dependencies: ["ClaudeHistoryShared"]),
    ]
)
