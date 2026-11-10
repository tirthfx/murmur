// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "murmur-helper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "murmur-helper", targets: ["murmur-helper"])
    ],
    targets: [
        // Protocol codec and message router. All logic lives here so `swift test` can cover it.
        .target(name: "MurmurHelperCore"),
        // Thin entry point: stdio, signals, exit codes.
        .executableTarget(name: "murmur-helper", dependencies: ["MurmurHelperCore"]),
        .testTarget(name: "MurmurHelperCoreTests", dependencies: ["MurmurHelperCore"]),
    ],
    swiftLanguageModes: [.v6]
)
