// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "murmur-helper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "murmur-helper", targets: ["murmur-helper"])
    ],
    dependencies: [
        // On-device speech recognition (MIT). Pinned exactly; see vault ADR-0013.
        .package(url: "https://github.com/argmaxinc/WhisperKit.git", exact: "1.1.1")
    ],
    targets: [
        // Protocol codec and message router. All logic lives here so `swift test` can cover it.
        .target(
            name: "MurmurHelperCore",
            dependencies: [.product(name: "WhisperKit", package: "WhisperKit")]),
        // Thin entry point: stdio, signals, exit codes.
        .executableTarget(name: "murmur-helper", dependencies: ["MurmurHelperCore"]),
        .testTarget(name: "MurmurHelperCoreTests", dependencies: ["MurmurHelperCore"]),
    ],
    swiftLanguageModes: [.v6]
)
