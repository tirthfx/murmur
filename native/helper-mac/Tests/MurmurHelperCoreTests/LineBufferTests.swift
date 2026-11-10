import XCTest

@testable import MurmurHelperCore

final class LineBufferTests: XCTestCase {
    func testSplitsMultipleLinesInOneChunk() {
        var buffer = LineBuffer()
        XCTAssertEqual(buffer.append(line("a\nb\nc\n")), [.line(line("a")), .line(line("b")), .line(line("c"))])
    }

    func testJoinsPartialLinesAcrossChunks() {
        var buffer = LineBuffer()
        XCTAssertEqual(buffer.append(line("{\"a\":")), [])
        XCTAssertEqual(buffer.append(line("1}\n{\"b\"")), [.line(line("{\"a\":1}"))])
        XCTAssertEqual(buffer.append(line(":2}\n")), [.line(line("{\"b\":2}"))])
    }

    func testMultiByteCharacterSplitAcrossChunks() {
        var buffer = LineBuffer()
        let bytes = Array("é\n".utf8)
        XCTAssertEqual(buffer.append(Data(bytes[0..<1])), [])
        XCTAssertEqual(buffer.append(Data(bytes[1...])), [.line(line("é"))])
    }

    func testOversizedLineIsReportedOnceAndSkipped() {
        var buffer = LineBuffer(maxLineBytes: 8)
        XCTAssertEqual(buffer.append(line("123456789")), [.oversized])
        XCTAssertEqual(buffer.append(line("more more")), [])
        XCTAssertEqual(buffer.append(line("tail\nok\n")), [.line(line("ok"))])
    }

    func testOversizedCompleteLine() {
        var buffer = LineBuffer(maxLineBytes: 4)
        XCTAssertEqual(buffer.append(line("12345\nabc\n")), [.oversized, .line(line("abc"))])
    }
}
