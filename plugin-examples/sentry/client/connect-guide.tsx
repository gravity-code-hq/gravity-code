import type { PluginTheme } from "@gravity/plugin";
import { useRpc } from "@gravity/plugin/client";
import { copyText, Icon, TextInput, useToast } from "@gravity/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { connectRpc, type SentryStatus } from "../shared/contracts";
import {
  isOrganizationToken,
  personalTokenUrl,
  SENTRY_TOKEN_PERMISSIONS,
  type SentryTokenPermission,
} from "../shared/onboarding";
import { Button, ChoiceChips, type PickerOption } from "./controls";
import { describeError } from "./format";
import { sentryKeys } from "./queries";
import { openExternal } from "./web";

const CLOUD_URL = "https://sentry.io";
const MONOSPACE = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
const ENVIRONMENT_EXAMPLE = [
  'export SENTRY_AUTH_TOKEN="sntryu_…"',
  "# Self-hosted only:",
  'export SENTRY_URL="https://sentry.example.com"',
].join("\n");

type Hosting = "cloud" | "self-hosted";

const HOSTING: PickerOption<Hosting>[] = [
  { value: "cloud", label: "Sentry.io" },
  { value: "self-hosted", label: "Self-hosted" },
];

interface ConnectGuideProps {
  theme: PluginTheme;
  hostLabel: string;
  onConnected?(): void;
}

/**
 * First-run setup: explains how to create a personal token with the right
 * permissions, then validates and saves it on the daemon. It renders no scroll
 * view so the settings shell can host it; the issues screen wraps it in one.
 */
export function ConnectGuide({ theme, hostLabel, onConnected }: ConnectGuideProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const connect = useRpc(connectRpc);
  const [hosting, setHosting] = useState<Hosting>("cloud");
  const [selfHostedUrl, setSelfHostedUrl] = useState("");
  const [token, setToken] = useState("");
  const [revealed, setRevealed] = useState(false);
  const mutation = useMutation({
    mutationFn: connect,
    onSuccess: (status: SentryStatus) => {
      queryClient.setQueryData(sentryKeys.status(), status);
      void queryClient.invalidateQueries({ queryKey: sentryKeys.all });
      if (status.state === "connected") {
        const names = status.organizations.map((organization) => organization.name).join(", ");
        toast.show(`Connected to ${names}`, { variant: "success" });
      }
      onConnected?.();
    },
  });
  const { mutate } = mutation;

  const baseUrl = hosting === "cloud" ? CLOUD_URL : selfHostedUrl.trim().replace(/\/+$/, "");
  const tokenPage = baseUrl ? personalTokenUrl(baseUrl) : null;
  const organizationToken = isOrganizationToken(token);
  const ready = token.trim().length > 0 && baseUrl.length > 0;

  const submit = useCallback(() => {
    if (!ready) return;
    mutate({ token: token.trim(), baseUrl });
  }, [baseUrl, mutate, ready, token]);
  const openCloud = useCallback(() => void openExternal(CLOUD_URL), []);
  const openTokenPage = useCallback(() => {
    if (tokenPage) void openExternal(tokenPage);
  }, [tokenPage]);
  const copyTokenPage = useCallback(async () => {
    if (!tokenPage) return;
    try {
      await copyText(tokenPage);
      toast.show("Link copied. Open it on a computer signed in to Sentry", { variant: "success" });
    } catch {
      toast.error("Could not copy the link");
    }
  }, [toast, tokenPage]);
  const copyLink = useCallback(() => void copyTokenPage(), [copyTokenPage]);
  const toggleReveal = useCallback(() => setRevealed((current) => !current), []);

  const styles = useMemo(
    () => ({
      guide: { gap: 20 },
      header: { gap: 8 },
      heading: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      title: { color: theme.colors.foreground, fontSize: 20, fontWeight: "600" as const },
      lead: { color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
      body: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      strong: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      warning: { color: theme.colors.statusWarning, fontSize: 13, lineHeight: 19 },
      input: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
      },
      tokenRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      tokenInput: {
        flex: 1,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: organizationToken ? theme.colors.statusWarning : theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        fontFamily: MONOSPACE,
      },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      error: {
        gap: 4,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.statusDanger,
      },
      errorTitle: { color: theme.colors.statusDanger, fontSize: 13, fontWeight: "600" as const },
      errorBody: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
      submit: { flexDirection: "row" as const, justifyContent: "flex-end" as const },
      link: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        alignSelf: "flex-start" as const,
        gap: 4,
      },
      linkText: { color: theme.colors.accent, fontSize: 13 },
      privacy: { flexDirection: "row" as const, gap: 8, alignItems: "flex-start" as const },
      privacyText: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    }),
    [organizationToken, theme],
  );

  return (
    <View style={styles.guide}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Icon name="Bug" size={24} color={theme.colors.foreground} />
          <Text style={styles.title}>Connect Sentry</Text>
        </View>
        <Text style={styles.lead}>
          Browse your Sentry issues here and hand any of them to an agent. The agent gets the stack
          trace, breadcrumbs, and request, finds the root cause in your repository, and fixes it or
          opens a pull request.
        </Text>
      </View>

      <Step theme={theme} number={1} title="Where is your Sentry?">
        <ChoiceChips theme={theme} options={HOSTING} value={hosting} onChange={setHosting} />
        {hosting === "cloud" ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open sentry.io"
            onPress={openCloud}
            style={styles.link}
          >
            <Text style={styles.linkText}>sentry.io</Text>
            <Icon name="ExternalLink" size={13} color={theme.colors.accent} />
          </Pressable>
        ) : (
          <>
            <TextInput
              value={selfHostedUrl}
              onChangeText={setSelfHostedUrl}
              placeholder="https://sentry.example.com"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
            <Text style={styles.body}>
              The address you open Sentry at. This host must be able to reach it.
            </Text>
          </>
        )}
      </Step>

      <Step theme={theme} number={2} title="Create a personal token">
        <Text style={styles.strong}>User Settings → Personal Tokens → Create New Token</Text>
        <View style={styles.actions}>
          <Button
            theme={theme}
            variant="primary"
            icon="ExternalLink"
            label="Open Personal Tokens"
            disabled={!tokenPage}
            onPress={openTokenPage}
          />
          <Button
            theme={theme}
            icon="Link"
            label="Copy link"
            disabled={!tokenPage}
            onPress={copyLink}
          />
        </View>
        <Text style={styles.body}>
          Use a personal token. Organization tokens only carry CI permissions and can’t read issues.
        </Text>
      </Step>

      <Step theme={theme} number={3} title="Give it these permissions">
        <PermissionTable theme={theme} />
        <Text style={styles.body}>
          Leave every other permission at No Access. Sentry can’t change a token’s permissions after
          you create it; if one is missing, create a new token.
        </Text>
      </Step>

      <Step theme={theme} number={4} title="Paste the token">
        <View style={styles.tokenRow}>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="sntryu_…"
            placeholderTextColor={theme.colors.foregroundMuted}
            secureTextEntry={!revealed}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submit}
            style={styles.tokenInput}
          />
          <Button
            theme={theme}
            variant="ghost"
            icon={revealed ? "EyeOff" : "Eye"}
            label=""
            accessibilityLabel={revealed ? "Hide token" : "Show token"}
            onPress={toggleReveal}
          />
        </View>
        {organizationToken ? (
          <Text style={styles.warning}>
            This looks like an organization token (sntrys_). It can’t read issues; create a personal
            token instead.
          </Text>
        ) : (
          <Text style={styles.body}>
            Sentry shows a token once. Copy it before you leave the page.
          </Text>
        )}
      </Step>

      {mutation.error ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorTitle}>Couldn’t connect</Text>
          <Text selectable style={styles.errorBody}>
            {describeError(mutation.error)}
          </Text>
        </View>
      ) : null}

      <View style={styles.submit}>
        <Button
          theme={theme}
          variant="primary"
          label={mutation.isPending ? "Checking token…" : "Connect"}
          icon="PlugZap"
          disabled={!ready}
          pending={mutation.isPending}
          onPress={submit}
        />
      </View>

      <View style={styles.privacy}>
        <Icon name="Lock" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.privacyText}>
          Gravity checks the token against Sentry, then stores it on {hostLabel} only, in
          $GRAVITY_HOME/plugin-data/sentry/credentials.json. It never reaches this app.
        </Text>
      </View>

      <EnvironmentHelp theme={theme} />
    </View>
  );
}

function Step({
  theme,
  number,
  title,
  children,
}: {
  theme: PluginTheme;
  number: number;
  title: string;
  children: ReactNode;
}) {
  const styles = useMemo(
    () => ({
      step: { flexDirection: "row" as const, gap: 12 },
      badge: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      number: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      content: { flex: 1, gap: 10 },
      title: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
    }),
    [theme],
  );
  return (
    <View style={styles.step}>
      <View style={styles.badge}>
        <Text style={styles.number}>{number}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

function PermissionTable({ theme }: { theme: PluginTheme }) {
  const styles = useMemo(
    () => ({
      table: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
    }),
    [theme],
  );
  return (
    <View style={styles.table}>
      {SENTRY_TOKEN_PERMISSIONS.map((permission, position) => (
        <PermissionRow
          key={permission.area}
          theme={theme}
          permission={permission}
          divided={position > 0}
        />
      ))}
    </View>
  );
}

function PermissionRow({
  theme,
  permission,
  divided,
}: {
  theme: PluginTheme;
  permission: SentryTokenPermission;
  divided: boolean;
}) {
  const styles = useMemo(
    () => ({
      row: {
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: theme.colors.border,
      },
      line: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      area: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      level: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      levelText: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      why: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      scope: { color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: MONOSPACE },
    }),
    [divided, theme],
  );
  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <Text style={styles.area}>{permission.area}</Text>
        <View style={styles.level}>
          <Text style={styles.levelText}>{permission.level}</Text>
        </View>
      </View>
      <Text style={styles.why}>{permission.why}</Text>
      <Text style={styles.scope}>{permission.scope}</Text>
    </View>
  );
}

/** The alternative for headless hosts: a token in the daemon environment. */
function EnvironmentHelp({ theme }: { theme: PluginTheme }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const copyExample = useCallback(async () => {
    try {
      await copyText(ENVIRONMENT_EXAMPLE);
      toast.show("Copied", { variant: "success" });
    } catch {
      toast.error("Could not copy");
    }
  }, [toast]);
  const copy = useCallback(() => void copyExample(), [copyExample]);
  const accessibilityState = useMemo(() => ({ expanded: open }), [open]);
  const styles = useMemo(
    () => ({
      section: { gap: 10 },
      trigger: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      triggerText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      body: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      code: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 12,
        lineHeight: 18,
      },
      actions: { flexDirection: "row" as const },
    }),
    [theme],
  );
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={toggle}
        style={styles.trigger}
      >
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
        <Text style={styles.triggerText}>
          Running the daemon on a server? Use an environment variable
        </Text>
      </Pressable>
      {open ? (
        <>
          <Text style={styles.body}>
            Set the token in the environment that starts the Gravity daemon, then restart it. A
            token saved here takes precedence over the environment one.
          </Text>
          <Text selectable style={styles.code}>
            {ENVIRONMENT_EXAMPLE}
          </Text>
          <View style={styles.actions}>
            <Button theme={theme} icon="Copy" label="Copy" onPress={copy} />
          </View>
        </>
      ) : null}
    </View>
  );
}
