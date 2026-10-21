import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputKeyPressEventData,
} from "react-native";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CopyMinus,
  Ellipsis,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { FileContentSearchFile, FileContentSearchMatch } from "@gravity/protocol/messages";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  TreeChevron,
  treeRowPaddingLeft,
  WORKSPACE_TREE_ICON_LABEL_GAP,
  WORKSPACE_TREE_ICON_SIZE,
  workspaceTreeRowStyles,
} from "@/components/tree-primitives";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  paneContentToolbarIconSize,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import {
  SearchOptionToggles,
  type SearchOption as OptionToggle,
} from "@/components/ui/search-option-toggles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { previewMatch, resultCountForm } from "@/components/workspace-search-preview";
import {
  useWorkspaceContentSearch,
  type WorkspaceContentSearchOptions,
  type WorkspaceContentSearchResult,
  type WorkspaceContentSearchState,
} from "@/hooks/use-workspace-content-search";
import {
  useWorkspaceFileNameSearch,
  type WorkspaceFileNameSearchState,
} from "@/hooks/use-workspace-file-name-search";
import type { Theme } from "@/styles/theme";

/*
 * Workspace search inside the Files pane, modelled on VS Code's Search view
 * (src/vs/workbench/contrib/search/browser): the find input carries the
 * match-case, whole-word, and regex toggles inline, "..." reveals files to
 * include / exclude, the message row reports "N results in M files" plus the
 * subset warning when the limit is hit, and each file row is icon + name +
 * dimmed folder + count badge over its matches. The Files pane owns the field
 * in its header and swaps the tree for the results while a query is present.
 */

const ThemedSearch = withUnistyles(Search);
const ThemedX = withUnistyles(X);
const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const ThemedCopyMinus = withUnistyles(CopyMinus);
const ThemedChevronsDownUp = withUnistyles(ChevronsDownUp);
const ThemedChevronsUpDown = withUnistyles(ChevronsUpDown);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
});
const foregroundIconColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const warningIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

const INLINE_TOGGLE_ICON_SIZE = 14;

export type WorkspaceSearchMode = "names" | "contents";

export interface WorkspaceSearchLocation {
  path: string;
  line?: number;
}

export interface WorkspaceSearchController {
  query: string;
  mode: WorkspaceSearchMode;
  options: WorkspaceContentSearchOptions;
  detailsOpen: boolean;
  loading: boolean;
  contentState: WorkspaceContentSearchState;
  nameState: WorkspaceFileNameSearchState;
  /** Bumps when "Clear Search Results" empties the field so it remounts blank. */
  fieldKey: number;
  setQuery: (query: string) => void;
  setMode: (mode: WorkspaceSearchMode) => void;
  submit: () => void;
  clear: () => void;
  clearResults: () => void;
  toggleOption: (option: OptionToggle) => void;
  toggleDetails: () => void;
  setInclude: (include: string) => void;
  setExclude: (exclude: string) => void;
}

type ResultRow =
  | { type: "file"; key: string; file: FileContentSearchFile; expanded: boolean }
  | { type: "match"; key: string; path: string; match: FileContentSearchMatch };

const DEFAULT_OPTIONS: WorkspaceContentSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: "",
  exclude: "",
};

function splitPath(path: string): { name: string; directory: string } {
  const separator = path.lastIndexOf("/");
  return separator >= 0
    ? { name: path.slice(separator + 1), directory: path.slice(0, separator) }
    : { name: path, directory: "" };
}

export function buildResultRows(
  files: readonly FileContentSearchFile[],
  collapsed: ReadonlySet<string>,
): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const file of files) {
    const expanded = !collapsed.has(file.path);
    rows.push({ type: "file", key: `file:${file.path}`, file, expanded });
    if (!expanded) continue;
    for (const match of file.matches) {
      rows.push({
        type: "match",
        key: `match:${file.path}:${match.line}:${match.column}`,
        path: file.path,
        match,
      });
    }
  }
  return rows;
}

/** The result set the list shows: the latest, or the previous one while a rerun is in flight. */
function visibleContentResult(
  state: WorkspaceContentSearchState,
): WorkspaceContentSearchResult | null {
  if (state.status === "success") return state.result;
  if (state.status === "loading") return state.previous;
  return null;
}

function visibleNamePaths(state: WorkspaceFileNameSearchState): readonly string[] {
  if (state.status === "success") return state.paths;
  if (state.status === "loading") return state.previous;
  return [];
}

function rowPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    workspaceTreeRowStyles.row,
    styles.resultRow,
    (Boolean(hovered) || pressed) && workspaceTreeRowStyles.active,
  ];
}

const FileResultRow = memo(function FileResultRow({
  file,
  expanded,
  onToggle,
}: {
  file: FileContentSearchFile;
  expanded: boolean;
  onToggle: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { name, directory } = splitPath(file.path);
  const handlePress = useCallback(() => onToggle(file.path), [file.path, onToggle]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const count = file.matches.length;
  return (
    <Pressable
      onPress={handlePress}
      style={rowPressableStyle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={`search-result-file-${file.path}`}
    >
      <View style={[styles.rowContent, { paddingLeft: treeRowPaddingLeft(0) }]}>
        <TreeChevron expanded={expanded} />
        <MaterialFileIcon fileName={name} size={WORKSPACE_TREE_ICON_SIZE} />
        <Text style={styles.fileName} numberOfLines={1}>
          {name}
        </Text>
        {directory ? (
          <Text style={styles.fileDirectory} numberOfLines={1}>
            {directory}
          </Text>
        ) : null}
      </View>
      <View
        style={styles.countBadge}
        accessibilityLabel={t("panels.search.fileMatches", { count })}
        testID={`search-result-count-${file.path}`}
      >
        <Text style={styles.countBadgeText}>{count}</Text>
      </View>
    </Pressable>
  );
});

const MatchResultRow = memo(function MatchResultRow({
  path,
  match,
  onOpen,
}: {
  path: string;
  match: FileContentSearchMatch;
  onOpen: (location: WorkspaceSearchLocation) => void;
}) {
  const preview = useMemo(() => previewMatch(match), [match]);
  const handlePress = useCallback(
    () => onOpen({ path, line: match.line }),
    [match.line, onOpen, path],
  );
  const title = (preview.fullBefore + preview.inside + preview.after).trim().substr(0, 999);
  return (
    <Pressable
      onPress={handlePress}
      style={rowPressableStyle}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={`search-result-match-${path}-${match.line}-${match.column}`}
    >
      <View style={[styles.rowContent, { paddingLeft: treeRowPaddingLeft(1) }]}>
        <Text style={styles.matchText} numberOfLines={1}>
          {preview.before}
          <Text style={styles.matchMark}>{preview.inside}</Text>
          {preview.after}
        </Text>
      </View>
    </Pressable>
  );
});

const NameResultRow = memo(function NameResultRow({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (location: WorkspaceSearchLocation) => void;
}) {
  const { name, directory } = splitPath(path);
  const handlePress = useCallback(() => onOpen({ path }), [onOpen, path]);
  return (
    <Pressable
      onPress={handlePress}
      style={rowPressableStyle}
      accessibilityRole="button"
      testID={`search-result-name-${path}`}
    >
      <View style={[styles.rowContent, { paddingLeft: treeRowPaddingLeft(0) }]}>
        <MaterialFileIcon fileName={name} size={WORKSPACE_TREE_ICON_SIZE} />
        <Text style={styles.fileName} numberOfLines={1}>
          {name}
        </Text>
        {directory ? (
          <Text style={styles.fileDirectory} numberOfLines={1}>
            {directory}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

function MessageText({ text, testID }: { text: string; testID?: string }) {
  return (
    <Text style={styles.message} testID={testID}>
      {text}
    </Text>
  );
}

function FilterField({
  label,
  value,
  placeholder,
  onChangeText,
  testID,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  testID: string;
}) {
  return (
    <View style={styles.filterField}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.filterInputFrame}>
        <ThemedTextInput
          initialValue={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          accessibilityLabel={label}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          testID={testID}
        />
      </View>
    </View>
  );
}

function SearchQueryField({
  query,
  mode,
  options,
  loading,
  compact,
  onChangeText,
  onSubmit,
  onClear,
  onToggleOption,
}: {
  query: string;
  mode: WorkspaceSearchMode;
  options: WorkspaceContentSearchOptions;
  loading: boolean;
  compact: boolean;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onToggleOption: (option: OptionToggle) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [isFocused, setIsFocused] = useState(false);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handleClear = useCallback(() => {
    inputRef.current?.replaceText("");
    onClear();
  }, [onClear]);
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Escape") handleClear();
    },
    [handleClear],
  );

  return (
    <View style={[styles.field, isFocused && styles.fieldFocused]}>
      <ThemedSearch size={14} uniProps={mutedIconColorMapping} />
      <ThemedTextInput
        ref={inputRef}
        initialValue={query}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onKeyPress={handleKeyPress}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={t("panels.search.placeholder")}
        accessibilityLabel={t("panels.search.placeholder")}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={!compact}
        returnKeyType="search"
        blurOnSubmit={false}
        style={styles.input}
        testID="search-query-input"
      />
      {loading ? <ThemedLoadingSpinner size="small" /> : null}
      {!loading && query.length > 0 ? (
        <Pressable
          onPress={handleClear}
          accessibilityRole="button"
          accessibilityLabel={t("panels.search.clear")}
          hitSlop={8}
          testID="search-clear"
        >
          <ThemedX size={14} uniProps={mutedIconColorMapping} />
        </Pressable>
      ) : null}
      {mode === "contents" ? (
        <SearchOptionToggles options={options} onToggle={onToggleOption} testIDPrefix="search" />
      ) : null}
    </View>
  );
}

function SearchModeRow({
  mode,
  detailsOpen,
  filtersActive,
  compact,
  onModeChange,
  onToggleDetails,
}: {
  mode: WorkspaceSearchMode;
  detailsOpen: boolean;
  filtersActive: boolean;
  compact: boolean;
  onModeChange: (mode: WorkspaceSearchMode) => void;
  onToggleDetails: () => void;
}) {
  const { t } = useTranslation();
  const modeOptions = useMemo(
    () => [
      {
        value: "names" as const,
        label: t("panels.search.modes.names"),
        testID: "search-mode-names",
      },
      {
        value: "contents" as const,
        label: t("panels.search.modes.contents"),
        testID: "search-mode-contents",
      },
    ],
    [t],
  );
  const detailsSelected = detailsOpen || filtersActive;
  return (
    <View style={styles.modeRow}>
      <SegmentedControl
        options={modeOptions}
        value={mode}
        onValueChange={onModeChange}
        size="xs"
        testID="search-mode"
      />
      {mode === "contents" ? (
        <ToolbarButton
          label={t("panels.search.actions.toggleDetails")}
          selected={detailsSelected}
          compact={compact}
          hitSlop={4}
          onPress={onToggleDetails}
          testID="search-toggle-details"
        >
          <ThemedEllipsis
            size={paneContentToolbarIconSize(compact)}
            uniProps={detailsSelected ? foregroundIconColorMapping : extraMutedIconColorMapping}
          />
        </ToolbarButton>
      ) : null}
    </View>
  );
}

/** VS Code's no-results message picks a variant from the include / exclude boxes. */
function noResultsMessage(
  t: (key: string, values?: Record<string, string>) => string,
  options: WorkspaceContentSearchOptions,
): string {
  const include = options.include.trim();
  const exclude = options.exclude.trim();
  if (include && exclude) {
    return t("panels.search.states.emptyIncludesExcludes", { include, exclude });
  }
  if (include) return t("panels.search.states.emptyIncludes", { include });
  if (exclude) return t("panels.search.states.emptyExcludes", { exclude });
  return t("panels.search.states.empty");
}

function ResultsHeader({
  result,
  anyExpanded,
  compact,
  onRefresh,
  onClear,
  onToggleCollapseAll,
}: {
  result: WorkspaceContentSearchResult;
  anyExpanded: boolean;
  compact: boolean;
  onRefresh: () => void;
  onClear: () => void;
  onToggleCollapseAll: () => void;
}) {
  const { t } = useTranslation();
  const iconSize = paneContentToolbarIconSize(compact);
  const form = resultCountForm(result.totalMatches, result.files.length);
  const CollapseIcon = anyExpanded ? ThemedChevronsDownUp : ThemedChevronsUpDown;
  return (
    <View style={styles.resultsHeader}>
      <View style={styles.messageRow}>
        <Text style={styles.summary} testID="search-results-summary">
          {t(`panels.search.count.${form}`, {
            count: result.totalMatches,
            files: result.files.length,
          })}
        </Text>
        <ToolbarControls style={styles.headerActions}>
          <ToolbarButton
            label={t("panels.search.actions.refresh")}
            compact={compact}
            hitSlop={4}
            onPress={onRefresh}
            testID="search-refresh"
          >
            <ThemedRefreshCw size={iconSize} uniProps={extraMutedIconColorMapping} />
          </ToolbarButton>
          <ToolbarButton
            label={t("panels.search.actions.clear")}
            compact={compact}
            hitSlop={4}
            onPress={onClear}
            testID="search-clear-results"
          >
            <ThemedCopyMinus size={iconSize} uniProps={extraMutedIconColorMapping} />
          </ToolbarButton>
          <ToolbarButton
            label={
              anyExpanded
                ? t("panels.search.actions.collapseAll")
                : t("panels.search.actions.expandAll")
            }
            compact={compact}
            hitSlop={4}
            onPress={onToggleCollapseAll}
            testID="search-collapse-all"
          >
            <CollapseIcon size={iconSize} uniProps={extraMutedIconColorMapping} />
          </ToolbarButton>
        </ToolbarControls>
      </View>
      {result.truncated ? (
        <View style={styles.warningRow} testID="search-limit-warning">
          <ThemedTriangleAlert size={INLINE_TOGGLE_ICON_SIZE} uniProps={warningIconColorMapping} />
          <Text style={styles.warningText}>{t("panels.search.states.limitHit")}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ContentResults({
  query,
  options,
  state,
  compact,
  onOpenLocation,
  onRefresh,
  onClear,
}: {
  query: string;
  options: WorkspaceContentSearchOptions;
  state: WorkspaceContentSearchState;
  compact: boolean;
  onOpenLocation: (location: WorkspaceSearchLocation) => void;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const result = visibleContentResult(state);
  // A new result set starts fully expanded; collapse state belongs to one search.
  const files = result?.files ?? null;
  useEffect(() => {
    setCollapsed(new Set());
  }, [files]);
  const rows = useMemo(() => (files ? buildResultRows(files, collapsed) : []), [collapsed, files]);
  const anyExpanded = files ? files.some((file) => !collapsed.has(file.path)) : false;
  const handleToggleFile = useCallback((path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const handleToggleCollapseAll = useCallback(() => {
    setCollapsed(anyExpanded && files ? new Set(files.map((file) => file.path)) : new Set());
  }, [anyExpanded, files]);
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<ResultRow>) =>
      item.type === "file" ? (
        <FileResultRow file={item.file} expanded={item.expanded} onToggle={handleToggleFile} />
      ) : (
        <MatchResultRow path={item.path} match={item.match} onOpen={onOpenLocation} />
      ),
    [handleToggleFile, onOpenLocation],
  );
  const keyExtractor = useCallback((item: ResultRow) => item.key, []);

  if (query.length === 0) {
    return <MessageText text={t("panels.search.states.prompt")} />;
  }
  if (state.status === "error") {
    return <MessageText text={state.message} testID="search-error" />;
  }
  if (!result) {
    return <View style={styles.results} />;
  }
  if (result.files.length === 0) {
    return <MessageText text={noResultsMessage(t, options)} testID="search-no-results" />;
  }
  return (
    <View style={styles.results}>
      <ResultsHeader
        result={result}
        anyExpanded={anyExpanded}
        compact={compact}
        onRefresh={onRefresh}
        onClear={onClear}
        onToggleCollapseAll={handleToggleCollapseAll}
      />
      <FlatList
        data={rows}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        testID="search-results-list"
      />
    </View>
  );
}

function NameResults({
  query,
  state,
  onOpenLocation,
}: {
  query: string;
  state: WorkspaceFileNameSearchState;
  onOpenLocation: (location: WorkspaceSearchLocation) => void;
}) {
  const { t } = useTranslation();
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<string>) => <NameResultRow path={item} onOpen={onOpenLocation} />,
    [onOpenLocation],
  );
  const keyExtractor = useCallback((item: string) => item, []);
  if (query.length === 0) {
    return <MessageText text={t("panels.search.states.namesPrompt")} />;
  }
  if (state.status === "error") {
    return <MessageText text={state.message} />;
  }
  if (state.status === "success" && state.paths.length === 0) {
    return <MessageText text={t("panels.search.states.empty")} />;
  }
  return (
    <FlatList
      data={visibleNamePaths(state)}
      renderItem={renderRow}
      keyExtractor={keyExtractor}
      style={styles.list}
      keyboardShouldPersistTaps="handled"
      testID="search-names-list"
    />
  );
}

export function useWorkspaceSearchController(input: {
  serverId: string;
  workspaceRoot: string | null;
  /** Whether the host pane is visible; hidden panes do not issue searches. */
  active?: boolean;
}): WorkspaceSearchController {
  const { serverId, workspaceRoot, active = true } = input;
  const [mode, setMode] = useState<WorkspaceSearchMode>("contents");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<WorkspaceContentSearchOptions>(DEFAULT_OPTIONS);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [runId, setRunId] = useState(0);
  const [fieldKey, setFieldKey] = useState(0);

  const contentState = useWorkspaceContentSearch({
    serverId,
    workspaceRoot,
    query,
    options,
    enabled: active && mode === "contents",
    runId,
  });
  const nameState = useWorkspaceFileNameSearch({
    serverId,
    workspaceRoot,
    query,
    enabled: active && mode === "names",
  });
  const loading =
    mode === "contents" ? contentState.status === "loading" : nameState.status === "loading";

  const clear = useCallback(() => setQuery(""), []);
  const clearResults = useCallback(() => {
    setQuery("");
    setFieldKey((value) => value + 1);
  }, []);
  const submit = useCallback(() => setRunId((value) => value + 1), []);
  const toggleOption = useCallback(
    (option: OptionToggle) =>
      setOptions((previous) => ({ ...previous, [option]: !previous[option] })),
    [],
  );
  const toggleDetails = useCallback(() => setDetailsOpen((value) => !value), []);
  const setInclude = useCallback(
    (include: string) => setOptions((previous) => ({ ...previous, include })),
    [],
  );
  const setExclude = useCallback(
    (exclude: string) => setOptions((previous) => ({ ...previous, exclude })),
    [],
  );

  return useMemo(
    () => ({
      query,
      mode,
      options,
      detailsOpen,
      loading,
      contentState,
      nameState,
      fieldKey,
      setQuery,
      setMode,
      submit,
      clear,
      clearResults,
      toggleOption,
      toggleDetails,
      setInclude,
      setExclude,
    }),
    [
      clear,
      clearResults,
      contentState,
      detailsOpen,
      fieldKey,
      loading,
      mode,
      nameState,
      options,
      query,
      setExclude,
      setInclude,
      submit,
      toggleDetails,
      toggleOption,
    ],
  );
}

/** The search field that lives in the Files pane header. */
export function WorkspaceSearchField({
  controller,
  compact,
}: {
  controller: WorkspaceSearchController;
  compact: boolean;
}): ReactElement {
  return (
    <SearchQueryField
      key={controller.fieldKey}
      query={controller.query}
      mode={controller.mode}
      options={controller.options}
      loading={controller.loading}
      compact={compact}
      onChangeText={controller.setQuery}
      onSubmit={controller.submit}
      onClear={controller.clear}
      onToggleOption={controller.toggleOption}
    />
  );
}

/** Mode switch plus the include / exclude boxes; always visible under the search field. */
export function WorkspaceSearchControls({
  controller,
  compact,
}: {
  controller: WorkspaceSearchController;
  compact: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { mode, options, detailsOpen } = controller;
  const filtersActive = options.include.trim().length > 0 || options.exclude.trim().length > 0;
  return (
    <View style={styles.controls} testID="search-controls">
      <SearchModeRow
        mode={mode}
        detailsOpen={detailsOpen}
        filtersActive={filtersActive}
        compact={compact}
        onModeChange={controller.setMode}
        onToggleDetails={controller.toggleDetails}
      />
      {mode === "contents" && detailsOpen ? (
        <View style={styles.filters} testID="search-filters">
          <FilterField
            label={t("panels.search.filters.includeLabel")}
            value={options.include}
            placeholder={t("panels.search.filters.includePlaceholder")}
            onChangeText={controller.setInclude}
            testID="search-include-input"
          />
          <FilterField
            label={t("panels.search.filters.excludeLabel")}
            value={options.exclude}
            placeholder={t("panels.search.filters.excludePlaceholder")}
            onChangeText={controller.setExclude}
            testID="search-exclude-input"
          />
        </View>
      ) : null}
    </View>
  );
}

/** The result list for the current mode; the host shows it in place of the tree while a query is present. */
export function WorkspaceSearchResults({
  controller,
  compact,
  onOpenLocation,
}: {
  controller: WorkspaceSearchController;
  compact: boolean;
  onOpenLocation: (location: WorkspaceSearchLocation) => void;
}): ReactElement {
  const { mode, options, query } = controller;
  return (
    <View style={styles.pane} testID="search-pane">
      {mode === "contents" ? (
        <ContentResults
          query={query}
          options={options}
          state={controller.contentState}
          compact={compact}
          onOpenLocation={onOpenLocation}
          onRefresh={controller.submit}
          onClear={controller.clearResults}
        />
      ) : (
        <NameResults query={query} state={controller.nameState} onOpenLocation={onOpenLocation} />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.background,
  },
  controls: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fieldFocused: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    height: 22,
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  filters: {
    gap: theme.spacing[2],
  },
  filterField: {
    gap: theme.spacing[1],
  },
  filterLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  filterInputFrame: {
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  results: {
    flex: 1,
    minHeight: 0,
  },
  resultsHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
    gap: theme.spacing[1],
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    minHeight: 24,
  },
  headerActions: {
    flexShrink: 0,
  },
  summary: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[1.5],
  },
  warningText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  resultRow: {
    gap: theme.spacing[2],
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: WORKSPACE_TREE_ICON_LABEL_GAP,
  },
  fileName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 0,
  },
  fileDirectory: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  countBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  matchText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  matchMark: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
  },
}));
