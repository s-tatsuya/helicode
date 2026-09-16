/**
 * Insert-mode commands (bound via the insert keymap; printable characters go
 * straight to VS Code's default `type`).
 */
import * as vscode from 'vscode';
import { CommandFn } from '../types';
import { vsCommand } from './util';

export const deleteCharBackward: CommandFn = () => vsCommand('deleteLeft');
export const deleteCharForward: CommandFn = () => vsCommand('deleteRight');
export const deleteWordBackward: CommandFn = () => vsCommand('deleteWordLeft');
export const deleteWordForward: CommandFn = () => vsCommand('deleteWordRight');
export const killToLineStart: CommandFn = () => vsCommand('deleteAllLeft');
export const killToLineEnd: CommandFn = () => vsCommand('deleteAllRight');
export const insertNewline: CommandFn = async () => {
  await vscode.commands.executeCommand('default:type', { text: '\n' });
};
export const insertTab: CommandFn = () => vsCommand('tab');
export const smartTab: CommandFn = () => vsCommand('tab');
export const insertModeMoveUp: CommandFn = () => vsCommand('cursorUp');
export const insertModeMoveDown: CommandFn = () => vsCommand('cursorDown');
export const insertModeMoveLeft: CommandFn = () => vsCommand('cursorLeft');
export const insertModeMoveRight: CommandFn = () => vsCommand('cursorRight');
export const insertModePageUp: CommandFn = () => vsCommand('cursorPageUp');
export const insertModePageDown: CommandFn = () => vsCommand('cursorPageDown');
export const insertModeHome: CommandFn = () => vsCommand('cursorHome');
export const insertModeEnd: CommandFn = () => vsCommand('cursorEnd');
