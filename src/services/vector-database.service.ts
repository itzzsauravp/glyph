import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import * as vscode from 'vscode';

export default class VectorDatabaseService {
    public readonly databaseConnection: lancedb.Connection;

    private constructor(databaseConnection: lancedb.Connection) {
        this.databaseConnection = databaseConnection;
    }

    private sanitizeTableName(tableName: string): string {
        return tableName.replace(/[^a-zA-Z0-9]/g, '_');
    }

    /**
     * Static Factory Method — connects to the LanceDB database.
     *
     */
    public static async connectGlobalDatabase(): Promise<VectorDatabaseService> {
        // i dont think i will ever use global config, let it just be in the pwd for the current repo for now.
        // await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        // const databasePath = context.globalStorageUri.fsPath;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error(
                '[VectorDatabaseService] No workspace folder is open. Cannot create .glyph database.',
            );
        }
        const databasePath = path.join(workspaceFolders[0].uri.fsPath, '.glyph', 'index');

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
    public async initializeWorkspaceTable(): Promise<lancedb.Table> {
        // kind of unnecessary to sanitize but just for sanity check. Get it ?? haha
        const sanitizedTableName = this.sanitizeTableName('embedding');
        const tableAlreadyExists = await this.hasTable(sanitizedTableName);

        if (tableAlreadyExists) {
            return await this.databaseConnection.openTable(sanitizedTableName);
        }

        const seedRow = [
            {
                vector: new Float32Array(768).fill(0),
                text: 'seed_marker',
                text_type: 'word',
                path: 'root',
                symbolName: 'init',
                fileHash: 'none',
            },
        ];

        const createdTable = await this.databaseConnection.createTable(sanitizedTableName, seedRow);
        return createdTable;
    }
}
