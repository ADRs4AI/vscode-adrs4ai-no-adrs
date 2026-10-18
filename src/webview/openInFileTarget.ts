import * as vscode from 'vscode'

/**
 * "Open in file ↗"'s show-options for the ADR document. `Beside` resolves
 * relative to the ACTIVE editor group, which after a click in the panel is
 * the panel's own group in the main window. A fixed `ViewColumn` number
 * (e.g. `Two`) instead counts every window's editor groups, auxiliary
 * (floating) windows included — with one floating window open, column Two
 * silently resolves to that window's own locked group instead of opening
 * beside the panel (Glazier 5.5's 2026-10-18 porthole brief, finding 3).
 */
export function openInFileShowOptions(): vscode.TextDocumentShowOptions {
  return { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
}
