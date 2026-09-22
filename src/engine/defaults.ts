// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Default keymap, transcribed from helix-term/src/keymap/default.rs.
 * Command names are Helix's; see engine/commands for the implementations.
 */
import { KeyTrieSpec, KeyTrieNode, buildTrie } from './keymap';

/**
 * Window mode (`Ctrl-w`, also `Space w`).
 *
 * Helix's own bindings come first; the remaining letters mirror Corral's tmux
 * prefix table (`ctrl+b <key>`) so the same key does the same thing whether it
 * is pressed after `Ctrl-w` here or after the Corral prefix anywhere else in
 * VS Code. Corral keys degrade to the matching built-in VS Code command (or a
 * status message) when Corral is not installed.
 */
const windowMode: KeyTrieSpec = {
  __name: 'Window',
  // ---- Helix ----
  'C-w | w': 'rotate_view',
  'C-s | s': 'hsplit',
  'C-v | v': 'vsplit',
  'C-t | t': 'transpose_view',
  f: 'goto_file_hsplit',
  F: 'goto_file_vsplit',
  'C-q | q': 'wclose',
  'C-o | o': 'wonly',
  'C-h | h | left': 'jump_view_left',
  'C-j | j | down': 'jump_view_down',
  'C-k | k | up': 'jump_view_up',
  'C-l | l | right': 'jump_view_right',
  L: 'swap_view_right',
  K: 'swap_view_up',
  H: 'swap_view_left',
  J: 'swap_view_down',
  n: {
    __name: 'New split scratch buffer',
    'C-s | s': 'hsplit_new',
    'C-v | v': 'vsplit_new',
  },
  // ---- Corral pane grid (same letters as the Corral prefix) ----
  c: 'corral_new_terminal',
  S: 'corral_split_down',
  V: 'corral_split_right',
  z: 'corral_zoom_pane',
  '=': 'corral_even_panes',
  x: 'corral_close_pane',
  1: 'focus_pane_1',
  2: 'focus_pane_2',
  3: 'focus_pane_3',
  4: 'focus_pane_4',
  5: 'focus_pane_5',
  6: 'focus_pane_6',
  7: 'focus_pane_7',
  8: 'focus_pane_8',
  ';': 'corral_focus_last_pane',
  ',': 'corral_rename_terminal',
  // ---- Corral agents / review / popups ----
  a: 'corral_pick_agent',
  A: 'corral_spawn_agent',
  i: 'corral_prompt_agent',
  e: 'corral_ask_agent',
  E: 'corral_focus_view',
  m: 'corral_comment_here',
  D: 'corral_send_review',
  d: 'corral_review_changes',
  ']': 'corral_next_change',
  '[': 'corral_prev_change',
  P: 'corral_popup',
  g: 'corral_lazygit',
  r: 'corral_apply_layout',
  R: 'corral_save_layout',
  W: 'corral_new_worktree',
  '?': 'corral_show_keymap',
};

const viewMode: KeyTrieSpec = {
  __name: 'View',
  'z | c': 'align_view_center',
  t: 'align_view_top',
  b: 'align_view_bottom',
  m: 'align_view_middle',
  'k | up': 'scroll_up',
  'j | down': 'scroll_down',
  'C-b | pageup': 'page_up',
  'C-f | pagedown': 'page_down',
  'C-u | backspace': 'page_cursor_half_up',
  'C-d | space': 'page_cursor_half_down',
  '/': 'search',
  '?': 'rsearch',
  n: 'search_next',
  N: 'search_prev',
};

export const normalSpec: KeyTrieSpec = {
  __name: 'Normal mode',
  'h | left': 'move_char_left',
  'j | down': 'move_visual_line_down',
  'k | up': 'move_visual_line_up',
  'l | right': 'move_char_right',

  t: 'find_till_char',
  f: 'find_next_char',
  T: 'till_prev_char',
  F: 'find_prev_char',
  r: 'replace',
  R: 'replace_with_yanked',
  'A-.': 'repeat_last_motion',

  '~': 'switch_case',
  '`': 'switch_to_lowercase',
  'A-`': 'switch_to_uppercase',

  home: 'goto_line_start',
  end: 'goto_line_end',

  w: 'move_next_word_start',
  b: 'move_prev_word_start',
  e: 'move_next_word_end',

  W: 'move_next_long_word_start',
  B: 'move_prev_long_word_start',
  E: 'move_next_long_word_end',

  v: 'select_mode',
  G: 'goto_line',
  g: {
    __name: 'Goto',
    g: 'goto_file_start',
    '|': 'goto_column',
    e: 'goto_last_line',
    f: 'goto_file',
    h: 'goto_line_start',
    l: 'goto_line_end',
    s: 'goto_first_nonwhitespace',
    d: 'goto_definition',
    D: 'goto_declaration',
    y: 'goto_type_definition',
    r: 'goto_reference',
    i: 'goto_implementation',
    t: 'goto_window_top',
    c: 'goto_window_center',
    b: 'goto_window_bottom',
    a: 'goto_last_accessed_file',
    m: 'goto_last_modified_file',
    n: 'goto_next_buffer',
    p: 'goto_previous_buffer',
    k: 'move_line_up',
    j: 'move_line_down',
    '.': 'goto_last_modification',
    w: 'goto_word',
  },
  ':': 'command_mode',

  i: 'insert_mode',
  I: 'insert_at_line_start',
  a: 'append_mode',
  A: 'insert_at_line_end',
  o: 'open_below',
  O: 'open_above',

  d: 'delete_selection',
  'A-d': 'delete_selection_noyank',
  c: 'change_selection',
  'A-c': 'change_selection_noyank',

  C: 'copy_selection_on_next_line',
  'A-C': 'copy_selection_on_prev_line',

  s: 'select_regex',
  'A-s': 'split_selection_on_newline',
  'A-minus': 'merge_selections',
  'A-_': 'merge_consecutive_selections',
  S: 'split_selection',
  ';': 'collapse_selection',
  'A-;': 'flip_selections',
  'A-o | A-up': 'expand_selection',
  'A-i | A-down': 'shrink_selection',
  'A-I | A-S-down': 'select_all_children',
  'A-p | A-left': 'select_prev_sibling',
  'A-n | A-right': 'select_next_sibling',
  'A-e': 'move_parent_node_end',
  'A-b': 'move_parent_node_start',
  'A-a': 'select_all_siblings',

  '%': 'select_all',
  x: 'extend_line_below',
  X: 'extend_to_line_bounds',
  'A-x': 'shrink_to_line_bounds',

  m: {
    __name: 'Match',
    m: 'match_brackets',
    s: 'surround_add',
    r: 'surround_replace',
    d: 'surround_delete',
    a: 'select_textobject_around',
    i: 'select_textobject_inner',
  },
  '[': {
    __name: 'Left bracket',
    d: 'goto_prev_diag',
    D: 'goto_first_diag',
    g: 'goto_prev_change',
    G: 'goto_first_change',
    f: 'goto_prev_function',
    t: 'goto_prev_class',
    a: 'goto_prev_parameter',
    c: 'goto_prev_comment',
    e: 'goto_prev_entry',
    T: 'goto_prev_test',
    p: 'goto_prev_paragraph',
    x: 'goto_prev_xml_element',
    space: 'add_newline_above',
  },
  ']': {
    __name: 'Right bracket',
    d: 'goto_next_diag',
    D: 'goto_last_diag',
    g: 'goto_next_change',
    G: 'goto_last_change',
    f: 'goto_next_function',
    t: 'goto_next_class',
    a: 'goto_next_parameter',
    c: 'goto_next_comment',
    e: 'goto_next_entry',
    T: 'goto_next_test',
    p: 'goto_next_paragraph',
    x: 'goto_next_xml_element',
    space: 'add_newline_below',
  },

  '/': 'search',
  '?': 'rsearch',
  n: 'search_next',
  N: 'search_prev',
  '*': 'search_selection_detect_word_boundaries',
  'A-*': 'search_selection',

  u: 'undo',
  U: 'redo',
  'A-u': 'earlier',
  'A-U': 'later',

  y: 'yank',
  p: 'paste_after',
  P: 'paste_before',

  Q: 'record_macro',
  q: 'replay_macro',

  '>': 'indent',
  '<': 'unindent',
  '=': 'format_selections',
  J: 'join_selections',
  'A-J': 'join_selections_space',
  K: 'keep_selections',
  'A-K': 'remove_selections',

  ',': 'keep_primary_selection',
  'A-,': 'remove_primary_selection',

  '&': 'align_selections',
  _: 'trim_selections',

  '(': 'rotate_selections_backward',
  ')': 'rotate_selections_forward',
  'A-(': 'rotate_selection_contents_backward',
  'A-)': 'rotate_selection_contents_forward',

  'A-:': 'ensure_selections_forward',

  esc: 'normal_mode',
  'C-b | pageup': 'page_up',
  'C-f | pagedown': 'page_down',
  'C-u': 'page_cursor_half_up',
  'C-d': 'page_cursor_half_down',

  'C-w': windowMode,

  'C-c': 'toggle_comments',

  'C-i | tab': 'jump_forward',
  'C-o': 'jump_backward',
  'C-s': 'save_selection',

  space: {
    __name: 'Space',
    f: 'file_picker',
    F: 'file_picker_in_current_directory',
    e: 'file_explorer',
    '.': 'file_explorer_in_current_buffer_directory',
    b: 'buffer_picker',
    j: 'jumplist_picker',
    s: 'symbol_picker',
    S: 'workspace_symbol_picker',
    d: 'diagnostics_picker',
    D: 'workspace_diagnostics_picker',
    g: 'changed_file_picker',
    a: 'code_action',
    "'": 'last_picker',
    G: {
      __name: 'Debug',
      __sticky: true,
      l: 'dap_launch',
      r: 'dap_restart',
      b: 'dap_toggle_breakpoint',
      c: 'dap_continue',
      h: 'dap_pause',
      i: 'dap_step_in',
      o: 'dap_step_out',
      n: 'dap_next',
      v: 'dap_variables',
      t: 'dap_terminate',
      'C-c': 'dap_edit_condition',
      'C-l': 'dap_edit_log',
      s: {
        __name: 'Switch',
        t: 'dap_switch_thread',
        f: 'dap_switch_stack_frame',
      },
      e: 'dap_enable_exceptions',
      E: 'dap_disable_exceptions',
    },
    w: windowMode,
    y: 'yank_to_clipboard',
    Y: 'yank_main_selection_to_clipboard',
    p: 'paste_clipboard_after',
    P: 'paste_clipboard_before',
    R: 'replace_selections_with_clipboard',
    '/': 'global_search',
    k: 'hover',
    r: 'rename_symbol',
    h: 'select_references_to_symbol_under_cursor',
    c: 'toggle_comments',
    C: 'toggle_block_comments',
    'A-c': 'toggle_line_comments',
    '?': 'command_palette',
  },
  z: viewMode,
  Z: { ...viewMode, __sticky: true },

  '"': 'select_register',
  '|': 'shell_pipe',
  'A-|': 'shell_pipe_to',
  '!': 'shell_insert_output',
  'A-!': 'shell_append_output',
  $: 'shell_keep_pipe',
  'C-z': 'suspend',

  'C-a': 'increment',
  'C-x': 'decrement',
};

export const selectOverrides: KeyTrieSpec = {
  __name: 'Select mode',
  'h | left': 'extend_char_left',
  'j | down': 'extend_visual_line_down',
  'k | up': 'extend_visual_line_up',
  'l | right': 'extend_char_right',

  w: 'extend_next_word_start',
  b: 'extend_prev_word_start',
  e: 'extend_next_word_end',
  W: 'extend_next_long_word_start',
  B: 'extend_prev_long_word_start',
  E: 'extend_next_long_word_end',

  'A-e': 'extend_parent_node_end',
  'A-b': 'extend_parent_node_start',

  n: 'extend_search_next',
  N: 'extend_search_prev',

  t: 'extend_till_char',
  f: 'extend_next_char',
  T: 'extend_till_prev_char',
  F: 'extend_prev_char',

  home: 'extend_to_line_start',
  end: 'extend_to_line_end',
  esc: 'exit_select_mode',

  v: 'normal_mode',
  g: {
    __name: 'Goto',
    g: 'extend_to_file_start',
    '|': 'extend_to_column',
    e: 'extend_to_last_line',
    k: 'extend_line_up',
    j: 'extend_line_down',
    w: 'extend_to_word',
  },
};

export const insertSpec: KeyTrieSpec = {
  __name: 'Insert mode',
  esc: 'normal_mode',

  'C-s': 'commit_undo_checkpoint',
  'C-x': 'completion',
  'C-r': 'insert_register',

  'C-w | A-backspace': 'delete_word_backward',
  'A-d | A-del': 'delete_word_forward',
  'C-u': 'kill_to_line_start',
  'C-k': 'kill_to_line_end',
  'C-h | backspace | S-backspace': 'delete_char_backward',
  'C-d | del': 'delete_char_forward',
  'C-j | ret': 'insert_newline',
  tab: 'smart_tab',
  'S-tab': 'insert_tab',

  up: 'move_visual_line_up',
  down: 'move_visual_line_down',
  left: 'move_char_left',
  right: 'move_char_right',
  pageup: 'page_up',
  pagedown: 'page_down',
  home: 'goto_line_start',
  end: 'goto_line_end_newline',
};

export function defaultKeymaps(): { normal: KeyTrieNode; select: KeyTrieNode; insert: KeyTrieNode } {
  const normal = buildTrie(normalSpec);
  const select = normal.clone();
  select.name = 'Select mode';
  select.merge(buildTrie(selectOverrides));
  const insert = buildTrie(insertSpec);
  return { normal, select, insert };
}
