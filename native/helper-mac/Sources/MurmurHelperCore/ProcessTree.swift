import AppKit
import Darwin

/// One running process: its id, its parent and its name.
public struct ProcessRow: Equatable, Sendable {
    public let pid: pid_t
    public let ppid: pid_t
    public let name: String

    public init(pid: pid_t, ppid: pid_t, name: String) {
        self.pid = pid
        self.ppid = ppid
        self.name = name
    }
}

/// The process table and the app in front. Tests use a fake.
public protocol ProcessTable: Sendable {
    func frontmostPid() -> pid_t?
    func rows() -> [ProcessRow]
}

/// `proc.foreground` (PZ-28): the names of the processes under the app in front, such as a
/// terminal's shells and what runs in them. Names only: no arguments or command lines leave
/// the helper.
public struct ProcessController: Sendable {
    static let maxNames = 64
    static let maxDepth = 6
    let table: any ProcessTable

    public init(table: any ProcessTable) { self.table = table }

    public func foreground() -> [String: JSONValue] {
        guard let root = table.frontmostPid() else { return ["names": .array([])] }
        let names = Self.descendantNames(of: root, in: table.rows())
        return ["names": .array(names.map { .string($0) })]
    }

    /// Breadth-first under `root`, lower case, each name once, in the order found.
    static func descendantNames(of root: pid_t, in rows: [ProcessRow]) -> [String] {
        var children: [pid_t: [ProcessRow]] = [:]
        for row in rows where row.pid != row.ppid { children[row.ppid, default: []].append(row) }
        var names: [String] = []
        var seen = Set<String>()
        var level: [pid_t] = [root]
        var visited: Set<pid_t> = [root]
        for _ in 0..<maxDepth {
            var next: [pid_t] = []
            for pid in level {
                for child in children[pid] ?? [] where !visited.contains(child.pid) {
                    visited.insert(child.pid)
                    next.append(child.pid)
                    let name = String(child.name.lowercased().prefix(64))
                    if !name.isEmpty, !seen.contains(name), names.count < maxNames {
                        seen.insert(name)
                        names.append(name)
                    }
                }
            }
            if next.isEmpty { break }
            level = next
        }
        return names
    }
}

/// The real process table, through libproc and sysctl. Only the user's own processes are
/// readable, which is all a terminal runs.
public struct SystemProcessTable: ProcessTable {
    /// Interpreters whose script name is the tool's name ("node …/bin/gemini" is "gemini").
    static func isInterpreter(_ name: String) -> Bool {
        name.range(of: #"^(node|python[0-9.]*|bun|deno|ruby)$"#, options: .regularExpression) != nil
    }

    public init() {}

    public func frontmostPid() -> pid_t? {
        Frontmost.application()?.processIdentifier
    }

    public func rows() -> [ProcessRow] {
        let count = proc_listallpids(nil, 0)
        guard count > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(count) + 32)
        let filled = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        guard filled > 0 else { return [] }
        var rows: [ProcessRow] = []
        for pid in pids.prefix(Int(filled)) where pid > 0 {
            var info = proc_bsdinfo()
            let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { continue }
            var name = withUnsafeBytes(of: info.pbi_name) { Self.cString($0) }
            if name.isEmpty { name = withUnsafeBytes(of: info.pbi_comm) { Self.cString($0) } }
            if Self.isInterpreter(name.lowercased()), let script = Self.scriptName(pid) {
                name = script
            }
            rows.append(ProcessRow(pid: pid, ppid: pid_t(info.pbi_ppid), name: name))
        }
        return rows
    }

    static func cString(_ bytes: UnsafeRawBufferPointer) -> String {
        let end = bytes.firstIndex(of: 0) ?? bytes.count
        return String(decoding: bytes.prefix(end), as: UTF8.self)
    }

    /// The base name of the first argument after the interpreter that is not an option. Only
    /// that name is kept; the arguments are read here and dropped.
    static func scriptName(_ pid: pid_t) -> String? {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0, size < 1_048_576 else { return nil }
        var buffer = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0, size > 4 else { return nil }
        let argc = buffer.withUnsafeBytes { $0.load(as: Int32.self) }
        var index = 4
        // The executable path, then padding zeros, then argv.
        while index < size, buffer[index] != 0 { index += 1 }
        while index < size, buffer[index] == 0 { index += 1 }
        var args: [String] = []
        while index < size, args.count < Int(argc) {
            let start = index
            while index < size, buffer[index] != 0 { index += 1 }
            args.append(String(decoding: buffer[start..<index], as: UTF8.self))
            index += 1
        }
        guard let script = args.dropFirst().first(where: { !$0.hasPrefix("-") }) else { return nil }
        let base = (script as NSString).lastPathComponent
        let name = (base as NSString).deletingPathExtension
        return name.isEmpty ? nil : name
    }
}
