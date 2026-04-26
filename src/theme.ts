import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { getCurrentProfile } from './profile/current.js';

const palette = () => getCurrentProfile().brand.palette;

const fg = (color: string) => (text: string) => chalk.hex(color)(text);
const bg = (color: string) => (text: string) => chalk.bgHex(color)(text);

export const theme = {
  primary: (text: string) => fg(palette().primary)(text),
  primaryLight: (text: string) => fg(palette().primaryLight)(text),
  success: (text: string) => fg(palette().success)(text),
  error: (text: string) => fg(palette().error)(text),
  warning: (text: string) => fg(palette().warning)(text),
  muted: (text: string) => fg(palette().muted)(text),
  mutedDark: (text: string) => fg(palette().mutedDark)(text),
  accent: (text: string) => fg(palette().accent)(text),
  white: (text: string) => fg(palette().white)(text),
  info: (text: string) => fg(palette().info)(text),
  queryBg: (text: string) => bg(palette().queryBg)(text),
  border: (text: string) => fg(palette().border)(text),
  dim: (text: string) => chalk.dim(text),
  bold: (text: string) => chalk.bold(text),
};

export const markdownTheme: MarkdownTheme = {
  heading: (text) => theme.bold(theme.primary(text)),
  link: (text) => theme.primaryLight(text),
  linkUrl: (text) => theme.dim(text),
  code: (text) => theme.primaryLight(text),
  codeBlock: (text) => theme.primaryLight(text),
  codeBlockBorder: (text) => theme.mutedDark(text),
  quote: (text) => theme.info(text),
  quoteBorder: (text) => theme.mutedDark(text),
  hr: (text) => theme.mutedDark(text),
  listBullet: (text) => theme.primary(text),
  bold: (text) => theme.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
};

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => theme.primaryLight(text),
  selectedText: (text) => theme.bold(theme.primaryLight(text)),
  description: (text) => theme.muted(text),
  scrollInfo: (text) => theme.muted(text),
  noMatch: (text) => theme.muted(text),
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => theme.border(text),
  selectList: selectListTheme,
};
