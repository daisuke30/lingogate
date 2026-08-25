import Foundation
import SQLite3

/// Errors from the thin SQLite3 wrapper.
public enum SQLiteError: Error, CustomStringConvertible {
    case open(String)
    case prepare(String)
    case step(String)
    case bind(String)

    public var description: String {
        switch self {
        case .open(let m):    return "SQLite open error: \(m)"
        case .prepare(let m): return "SQLite prepare error: \(m)"
        case .step(let m):    return "SQLite step error: \(m)"
        case .bind(let m):    return "SQLite bind error: \(m)"
        }
    }
}

// SQLite wants to know whether a bound blob/text is transient (copy it) or
// static. We always copy, so all binds are safe against Swift string lifetime.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// A minimal Swift wrapper over the SQLite3 C API. No external dependency:
/// `import SQLite3` links the system library on both iOS and macOS.
public final class Database {
    fileprivate var handle: OpaquePointer?

    /// Open (or create) a database at `path`.
    /// - Parameter readonly: open read-only (used for the bundled content DB in
    ///   tests / read paths). Defaults to read-write.
    public init(path: String, readonly: Bool = false) throws {
        let flags = readonly
            ? SQLITE_OPEN_READONLY
            : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
        if sqlite3_open_v2(path, &handle, flags, nil) != SQLITE_OK {
            let msg = String(cString: sqlite3_errmsg(handle))
            sqlite3_close(handle)
            throw SQLiteError.open("\(msg) (path: \(path))")
        }
        _ = try? execute("PRAGMA foreign_keys = ON;")
    }

    deinit {
        sqlite3_close(handle)
    }

    /// Run one or more SQL statements with no result rows.
    public func execute(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(handle, sql, nil, nil, &err) != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(err)
            throw SQLiteError.step(msg)
        }
    }

    /// Prepare a statement for iteration/binding.
    public func prepare(_ sql: String) throws -> Statement {
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) != SQLITE_OK {
            let msg = String(cString: sqlite3_errmsg(handle))
            throw SQLiteError.prepare("\(msg) — SQL: \(sql)")
        }
        return Statement(stmt: stmt, db: self)
    }

    /// The rowid of the most recent successful INSERT.
    public var lastInsertRowID: Int64 { sqlite3_last_insert_rowid(handle) }
}

/// A prepared statement. Bind with 1-based indices, then `step()` to iterate.
public final class Statement {
    private var stmt: OpaquePointer?
    private unowned let db: Database

    init(stmt: OpaquePointer?, db: Database) {
        self.stmt = stmt
        self.db = db
    }

    deinit {
        sqlite3_finalize(stmt)
    }

    // MARK: Binding (1-based)

    @discardableResult public func bind(_ index: Int, _ value: Int) -> Statement {
        sqlite3_bind_int64(stmt, Int32(index), Int64(value)); return self
    }
    @discardableResult public func bind(_ index: Int, _ value: Int64) -> Statement {
        sqlite3_bind_int64(stmt, Int32(index), value); return self
    }
    @discardableResult public func bind(_ index: Int, _ value: Double) -> Statement {
        sqlite3_bind_double(stmt, Int32(index), value); return self
    }
    @discardableResult public func bind(_ index: Int, _ value: String) -> Statement {
        sqlite3_bind_text(stmt, Int32(index), value, -1, SQLITE_TRANSIENT); return self
    }
    @discardableResult public func bind(_ index: Int, _ value: String?) -> Statement {
        if let v = value { return bind(index, v) }
        sqlite3_bind_null(stmt, Int32(index)); return self
    }
    @discardableResult public func bind(_ index: Int, _ value: Double?) -> Statement {
        if let v = value { return bind(index, v) }
        sqlite3_bind_null(stmt, Int32(index)); return self
    }
    @discardableResult public func bind(_ index: Int, _ value: Int?) -> Statement {
        if let v = value { return bind(index, v) }
        sqlite3_bind_null(stmt, Int32(index)); return self
    }

    // MARK: Stepping

    /// Advance to the next row. Returns true if a row is available, false when
    /// the result set is exhausted (or the statement had no rows).
    @discardableResult public func step() throws -> Bool {
        let rc = sqlite3_step(stmt)
        switch rc {
        case SQLITE_ROW:  return true
        case SQLITE_DONE: return false
        default:
            throw SQLiteError.step(String(cString: sqlite3_errmsg(sqlite3_db_handle(stmt))))
        }
    }

    // MARK: Column access (0-based)

    public func isNull(_ index: Int) -> Bool {
        sqlite3_column_type(stmt, Int32(index)) == SQLITE_NULL
    }
    public func int(_ index: Int) -> Int {
        Int(sqlite3_column_int64(stmt, Int32(index)))
    }
    public func intOptional(_ index: Int) -> Int? {
        isNull(index) ? nil : int(index)
    }
    public func double(_ index: Int) -> Double {
        sqlite3_column_double(stmt, Int32(index))
    }
    public func doubleOptional(_ index: Int) -> Double? {
        isNull(index) ? nil : double(index)
    }
    public func string(_ index: Int) -> String {
        guard let c = sqlite3_column_text(stmt, Int32(index)) else { return "" }
        return String(cString: c)
    }
    public func stringOptional(_ index: Int) -> String? {
        isNull(index) ? nil : string(index)
    }
}
