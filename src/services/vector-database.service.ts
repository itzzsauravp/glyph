import * as vscode from "vscode";
import * as lancedb from "@lancedb/lancedb";
import path from "path";

export default class VectorDatabaseService {
    public readonly databaseConnection: lancedb.Connection;

    private constructor(databaseConnection: lancedb.Connection) {
        this.databaseConnection = databaseConnection;
    }

    private sanitizeTableName(tableName: string): string {
        return tableName.replace(/[^a-zA-Z0-9]/g, "_");
    }

    /**
     * Static Factory Method — connects to the LanceDB database.
     *
     * DEV MODE: Stores the `.lance` folder in the workspace root so you can
     *           inspect files easily during development.
     *
     * PRODUCTION (commented out): Uses context.globalStorageUri which is the
     *           proper VS Code way — one global DB shared across all workspaces.
     */
    public static async connectGlobalDatabase(): Promise<VectorDatabaseService> {

        // ============================================================
        // PRODUCTION — uncomment these lines and delete the DEV block
        // ============================================================
        // await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        // const databasePath = context.globalStorageUri.fsPath;

        // ============================================================
        // DEV MODE — store in workspace root under .glyph/index for easy inspection
        // ============================================================
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error("[VectorDatabaseService] No workspace folder is open. Cannot create .glyph database.");
        }
        const databasePath = path.join(workspaceFolders[0].uri.fsPath, ".glyph", "index");

        const databaseConnection = await lancedb.connect(databasePath);

        return new VectorDatabaseService(databaseConnection);
    }

    /**
     * Checks whether a table with the given name already exists in the database.
     */
    public async hasTable(tableName: string): Promise<boolean> {
        const sanitizedTableName = this.sanitizeTableName(tableName);
        const existingTableNames = await this.databaseConnection.tableNames();
        return existingTableNames.includes(sanitizedTableName);
    }

    /**
     * Opens an existing workspace table or creates a new one.
     * The table name is sanitised to remove non-alphanumeric characters.
     * A seed row is inserted on creation so LanceDB can infer the schema.
     */
    public async initializeWorkspaceTable(workspaceName: string): Promise<lancedb.Table> {
        const sanitizedTableName = this.sanitizeTableName(workspaceName);
        const tableAlreadyExists = await this.hasTable(sanitizedTableName);

        if (tableAlreadyExists) {
            return await this.databaseConnection.openTable(sanitizedTableName);
        }

        const seedRow = [
            {
                vector: new Float32Array(768).fill(0),
                text: "seed_marker",
                text_type: "word",
                path: "root",
                symbolName: "init",
                fileHash: "none",
            },
        ];

        const createdTable = await this.databaseConnection.createTable(sanitizedTableName, seedRow);
        return createdTable;
    }
}