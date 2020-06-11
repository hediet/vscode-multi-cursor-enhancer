import { Rename, renameMany, setContext } from "./vscode-api";
import { Disposable } from "@hediet/std/disposable";
import { diffWords } from "diff";
import {
	commands,
	window,
	TextEditor,
	workspace,
	env,
	Selection,
	Range,
	ThemeColor,
	WorkspaceEdit,
	ProgressLocation,
} from "vscode";

export class MultiRename {
	public readonly dispose = Disposable.fn();
	private multiRenameOperation: MultiRenameOperation | undefined = undefined;

	constructor() {
		this.dispose.track([
			commands.registerCommand("multi-cursor-enhancer.multi-rename", () =>
				this.invoke()
			),
			commands.registerCommand(
				"multi-cursor-enhancer.multi-rename.cancel",
				() => this.cancel()
			),
			{
				dispose: () => {
					if (this.multiRenameOperation) {
						this.multiRenameOperation.cancel();
					}
				},
			},
			window.onDidChangeActiveTextEditor((e) => {
				this.cancel();
			}),
		]);
	}

	public async invoke(): Promise<void> {
		if (this.multiRenameOperation) {
			await this.multiRenameOperation.submit();
			this.multiRenameOperation = undefined;
		} else {
			const context = getContext();
			if (!context) {
				commands.executeCommand("editor.action.rename");
				return;
			}
			this.multiRenameOperation = new MultiRenameOperation(
				context.editor
			);

			window.withProgress(
				{
					cancellable: true,
					title: "Renaming",
					location: ProgressLocation.Notification,
				},
				(p, t) => {
					return new Promise((res) =>
						this.multiRenameOperation!.dispose.track({
							dispose: res,
						})
					);
				}
			);
		}
	}

	public async cancel(): Promise<void> {
		if (this.multiRenameOperation) {
			this.multiRenameOperation.cancel();
			this.multiRenameOperation = undefined;
		}
	}
}

class MultiRenameOperation {
	public readonly dispose = Disposable.fn();
	private readonly statusBarItem = this.dispose.track(
		window.createStatusBarItem(undefined, 10000)
	);

	private readonly sourceText: string;

	private readonly changedDecoration = this.dispose.track(
		window.createTextEditorDecorationType({
			backgroundColor: new ThemeColor(
				"peekViewEditor.matchHighlightBackground"
			),
		})
	);

	public constructor(private readonly activeEditor: TextEditor) {
		this.statusBarItem.show();
		this.statusBarItem.text = "$(edit) Multi Rename Active";
		this.statusBarItem.command =
			"multi-cursor-enhancer.multi-rename.cancel";
		setContext("multiRename.isActive", true);

		this.sourceText = activeEditor.document.getText();

		this.dispose.track([
			{
				dispose: () => {
					setContext("multiRename.isActive", false);
				},
			},
			workspace.onDidChangeTextDocument((e) => {
				if (e.document === this.activeEditor.document) {
					this.handleChange();
				}
			}),
		]);
	}

	private handleChange(): Rename[] {
		const document = this.activeEditor.document;
		const text = document.getText();
		const changes = diffWords(this.sourceText, text);

		const renames = new Array<Rename>();

		let pos = 0;
		for (const change of changes) {
			if (change.added) {
				const startPos = document.positionAt(pos);
				pos += change.value.length;
				const endPos = document.positionAt(pos);
				renames.push({
					uri: document.uri,
					range: new Range(startPos, endPos),
					newName: change.value,
				});
			} else if (change.removed) {
			} else {
				pos += change.value.length;
			}
		}

		if (pos !== text.length) {
			throw new Error("Should not happen");
		}

		this.activeEditor.setDecorations(
			this.changedDecoration,
			renames.map((r) => r.range)
		);
		return renames;
	}

	public cancel(): void {
		this.dispose();
	}

	public async submit(): Promise<void> {
		const edit = new WorkspaceEdit();
		const doc = this.activeEditor.document;
		const changes = this.handleChange();
		edit.replace(
			doc.uri,
			new Range(0, 0, doc.lineCount, 0),
			this.sourceText
		);
		await workspace.applyEdit(edit);
		await renameMany(changes);
		this.dispose();
	}
}

export class MultiRename2 {
	async invoke(): Promise<void> {
		const context = getContext();
		if (!context) {
			commands.executeCommand("editor.action.rename");
			return;
		}

		const { editor, selections } = context;

		const clipboard = await env.clipboard.readText();
		let newNames = clipboard
			.split("\n")
			.map((n) => n.trim())
			.slice(0, selections.length);

		const result = await window.showInputBox({
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
			uri: editor.document.uri,
			range: sel,
			newName: newNames[idx],
		}));

		await renameMany(renames);
	}
}

function getContext():
	| { selections: Selection[]; editor: TextEditor }
	| undefined {
	const targetTextEditor = window.activeTextEditor;
	if (!targetTextEditor) {
		return undefined;
	}

	if (targetTextEditor.selections.length < 2) {
		return undefined;
	}
	return {
		selections: targetTextEditor.selections,
		editor: targetTextEditor,
	};
}
