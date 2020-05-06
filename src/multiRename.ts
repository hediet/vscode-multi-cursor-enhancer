import * as vscode from "vscode";

export class MultiRename {
	async invoke(): Promise<void> {
		const context = this.getContext();
		if (!context) {
			vscode.commands.executeCommand("editor.action.rename");
			return;
		}

		const { document, selections } = context;

		const clipboard = await vscode.env.clipboard.readText();
		let newNames = clipboard
			.split("\n")
			.map((n) => n.trim())
			.slice(0, selections.length);

		const result = await vscode.window.showInputBox({
			value: newNames.join(","),
			prompt: "Enter the new names, separated by comma.",
			validateInput: (val) => {
				const newNames = val.split(",");
				if (newNames.length !== selections.length) {
					return `Please specify exactly ${selections.length} new names. Found ${newNames.length}.`;
				}
				return undefined;
			},
		});

		if (!result) {
			return;
		}

		newNames = result.split(",");

		const renames: Rename[] = selections.map((sel, idx) => ({
			uri: document.uri,
			position: sel.start,
			newName: newNames[idx],
		}));

		await this.renameMany(renames);
	}

	getContext():
		| { selections: vscode.Selection[]; document: vscode.TextDocument }
		| undefined {
		const targetTextEditor = vscode.window.activeTextEditor;
		if (!targetTextEditor) {
			return undefined;
		}

		if (targetTextEditor.selections.length < 2) {
			return undefined;
		}
		return {
			selections: targetTextEditor.selections,
			document: targetTextEditor.document,
		};
	}

	private async renameMany(renames: Rename[]): Promise<void> {
		for (const r of renames) {
			const result: vscode.WorkspaceEdit = await this.rename(
				r.uri,
				r.position,
				r.newName
			);
			await vscode.workspace.applyEdit(result);
		}
	}

	private async rename(
		uri: vscode.Uri,
		position: vscode.Position,
		newName: string
	): Promise<vscode.WorkspaceEdit> {
		return (await vscode.commands.executeCommand(
			"vscode.executeDocumentRenameProvider",
			uri,
			position,
			newName
		)) as any;
	}
}

interface Rename {
	uri: vscode.Uri;
	position: vscode.Position;
	newName: string;
}
