import { Button } from "@/components/ui/button";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import { X, ArrowUp, RefreshCcw, Check, Mic, Pencil } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { VolumeMeter } from "./volume-meter";

import type { Theme } from "@/styles/theme";
import type { DictationStatus } from "@/hooks/use-dictation";

interface DictationControlsProps {
  volume: number;
  duration: number;
  transcript?: string;
  isRecording: boolean;
  isProcessing: boolean;
  status: DictationStatus;
  onStart: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onAcceptAndSend: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
  disabled?: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function DictationControls({
  volume,
  duration,
  isRecording,
  isProcessing,
  status,
  onStart,
  onCancel,
  onAccept,
  onAcceptAndSend,
  onRetry,
  onDiscard,
  disabled = false,
}: DictationControlsProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isFailed = status === "failed";
  const showActiveState = isRecording || isProcessing || isFailed;
  const actionsDisabled = isProcessing;
  const handleCancel = isFailed && onDiscard ? onDiscard : onCancel;

  const micButtonStyle = useMemo(
    () => [styles.micButton, disabled && styles.buttonDisabled],
    [disabled],
  );
  const timerTextStyle = useMemo(
    () => [styles.timerText, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const cancelButtonStyle = useMemo(
    () => [
      styles.actionButton,
      styles.actionButtonCancel,
      actionsDisabled && !isFailed ? styles.buttonDisabled : undefined,
    ],
    [actionsDisabled, isFailed],
  );

  if (!showActiveState) {
    return (
      <Pressable
        onPress={onStart}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("message.dictation.start")}
        style={micButtonStyle}
      >
        <Mic size={theme.iconSize.md} color={theme.colors.foreground} />
      </Pressable>
    );
  }

  return (
    <View style={styles.activeContainer}>
      <View style={styles.meterWrapper}>
        <VolumeMeter volume={volume} isMuted={false} isSpeaking={false} orientation="horizontal" />
      </View>
      <Text style={timerTextStyle}>{formatDuration(duration)}</Text>
      <View style={styles.actionGroup}>
        <Pressable
          onPress={handleCancel}
          disabled={actionsDisabled && !isFailed}
          accessibilityLabel={t("message.dictation.cancel")}
          style={cancelButtonStyle}
        >
          <X size={theme.iconSize.sm} color={theme.colors.foreground} />
        </Pressable>
        {actionsDisabled ? (
          <View style={styles.loadingContainer}>
            <LoadingSpinner size="small" color={theme.colors.foreground} />
          </View>
        ) : null}
        {!actionsDisabled && isFailed ? (
          <Pressable
            onPress={onRetry}
            accessibilityLabel={t("message.dictation.retry")}
            style={[styles.actionButton, styles.actionButtonConfirm]}
          >
            <RefreshCcw size={theme.iconSize.sm} color={theme.colors.surface0} />
          </Pressable>
        ) : null}
        {!actionsDisabled && !isFailed ? (
          <>
            <Pressable
              onPress={onAccept}
              accessibilityLabel={t("message.dictation.insert")}
              style={[styles.actionButton, styles.actionButtonSecondary]}
            >
              <Check size={theme.iconSize.sm} color={theme.colors.foreground} />
            </Pressable>
            <Pressable
              onPress={onAcceptAndSend}
              accessibilityLabel={t("message.dictation.insertAndSend")}
              style={[styles.actionButton, styles.actionButtonConfirm]}
            >
              <ArrowUp size={theme.iconSize.sm} color={theme.colors.surface0} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

/** Dictation owns the composer layout while recording or processing. */
export function DictationOverlay({
  transcript = "",
  volume,
  duration,
  isRecording,
  isProcessing,
  status,
  errorText,
  onCancel,
  onAccept,
  onAcceptAndSend,
  onRetry,
  onDiscard,
}: Omit<DictationControlsProps, "onStart" | "disabled"> & { errorText?: string }) {
  const transcriptRef = useRef<ScrollView>(null);
  const scrollToLatestTranscript = useCallback(() => {
    transcriptRef.current?.scrollToEnd({ animated: false });
  }, []);
  const { t } = useTranslation();
  const isFailed = status === "failed";
  const showActiveState = isRecording || isProcessing || isFailed;
  const handleCancel = isFailed && onDiscard ? onDiscard : onCancel;
  let statusLabel = t("message.dictation.listening");
  if (isProcessing) statusLabel = t("message.dictation.transcribing");
  if (isFailed) statusLabel = t("message.dictation.stopped");

  if (!showActiveState) return null;

  return (
    <View style={overlayStyles.container} testID="dictation-overlay">
      {transcript ? (
        <View style={overlayStyles.transcriptContainer}>
          <ScrollView
            ref={transcriptRef}
            style={overlayStyles.transcriptScroll}
            onContentSizeChange={scrollToLatestTranscript}
          >
            <Text testID="dictation-transcript" style={overlayStyles.liveTranscriptText}>
              {transcript}
            </Text>
          </ScrollView>
        </View>
      ) : null}
      <View style={overlayStyles.controlsRow}>
        <View style={overlayStyles.meterRow}>
          {isProcessing ? (
            <ThemedLoadingSpinner size="small" uniProps={overlayColorProps} />
          ) : (
            <DictationWaveform volume={volume} isRecording={isRecording} />
          )}
          <Text style={overlayStyles.statusText}>{statusLabel}</Text>
          <Text style={overlayStyles.timerText}>{formatDuration(duration)}</Text>
        </View>
        <View style={overlayStyles.actionButtonsContainer}>
          <Button
            onPress={handleCancel}
            disabled={isProcessing}
            accessibilityLabel={t("message.dictation.cancel")}
            variant="ghost"
            style={overlayStyles.actionButton}
            leftIcon={X}
          />
          {isFailed ? (
            <Button
              onPress={onRetry}
              accessibilityLabel={t("message.dictation.retry")}
              variant="default"
              style={overlayStyles.actionButton}
              leftIcon={RefreshCcw}
            />
          ) : (
            <>
              <Button
                onPress={onAccept}
                disabled={isProcessing}
                accessibilityLabel={t("message.dictation.insert")}
                variant="outline"
                style={overlayStyles.actionButton}
                leftIcon={Pencil}
              />
              <Button
                onPress={onAcceptAndSend}
                disabled={isProcessing}
                accessibilityLabel={t("message.dictation.insertAndSend")}
                variant="default"
                style={overlayStyles.actionButton}
                leftIcon={ArrowUp}
              />
            </>
          )}
        </View>
      </View>
      {isFailed ? (
        <Text accessibilityRole="alert" style={overlayStyles.errorText}>
          {errorText
            ? t("message.dictation.failed", { error: errorText })
            : t("message.dictation.failedRetry")}
        </Text>
      ) : null}
    </View>
  );
}

const WAVEFORM_BARS = [
  { id: "outer-left", height: 0.4, phaseOffset: 0 },
  { id: "inner-left", height: 0.7, phaseOffset: 0.8 },
  { id: "center", height: 1, phaseOffset: 1.6 },
  { id: "inner-right", height: 0.7, phaseOffset: 2.4 },
  { id: "outer-right", height: 0.4, phaseOffset: 3.2 },
];

function DictationWaveform({ volume, isRecording }: { volume: number; isRecording: boolean }) {
  const isPanelActive = useRetainedPanelActive();
  const reduceMotion = useReducedMotion();
  const animate = isRecording && isPanelActive && !reduceMotion;
  const phase = useSharedValue(0);
  const level = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      phase.value = 0;
      return;
    }
    // All five bars share one clock; hidden panels and stopped recordings detach it.
    phase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [animate, phase]);

  useEffect(() => {
    if (!animate) {
      level.value = 0;
      return;
    }
    level.value = withTiming(Math.min(1, Math.max(0, volume)), { duration: 100 });
    return () => cancelAnimation(level);
  }, [animate, level, volume]);

  return (
    <View
      style={overlayStyles.waveform}
      testID="dictation-waveform"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {WAVEFORM_BARS.map(({ id, height, phaseOffset }) => (
        <DictationWaveformBar
          key={id}
          id={id}
          height={height}
          phaseOffset={phaseOffset}
          phase={phase}
          level={level}
          animate={animate}
        />
      ))}
    </View>
  );
}

function DictationWaveformBar({
  id,
  height,
  phaseOffset,
  phase,
  level,
  animate,
}: {
  id: string;
  height: number;
  phaseOffset: number;
  phase: SharedValue<number>;
  level: SharedValue<number>;
  animate: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    if (!animate) return { transform: [{ scaleY: height }] };
    const pulse = (Math.sin(phase.value + phaseOffset) + 1) / 2;
    const scale = Math.min(1, height * (0.55 + pulse * 0.35 + level.value * 0.3));
    return { transform: [{ scaleY: scale }] };
  });

  return (
    <Animated.View style={animatedStyle} testID={`dictation-waveform-${id}`}>
      <View style={overlayStyles.waveformBar} />
    </Animated.View>
  );
}

const BUTTON_SIZE = 32;

const styles = StyleSheet.create((theme) => ({
  micButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  activeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  meterWrapper: {
    width: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  timerText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ["tabular-nums"],
  },
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  actionButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
  },
  actionButtonCancel: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  actionButtonSecondary: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  actionButtonConfirm: {
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.foreground,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  loadingContainer: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  statusLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
}));

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const overlayColorProps = (theme: Theme) => ({ color: theme.colors.accent });

const overlayStyles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.surface1,
    width: "100%",
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[4] },
    paddingVertical: { xs: theme.spacing[2], md: theme.spacing[4] },
    gap: theme.spacing[3],
  },
  transcriptContainer: {
    paddingBottom: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  transcriptScroll: {
    maxHeight: theme.fontSize.content * 1.4 * 4,
    flexGrow: 0,
  },
  liveTranscriptText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    fontWeight: theme.fontWeight.normal,
    lineHeight: theme.fontSize.content * 1.4,
  },
  controlsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  meterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: CONTROL_HEIGHTS.field,
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: theme.spacing[8],
  },
  waveformBar: {
    width: theme.spacing[1],
    height: theme.spacing[8],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  timerText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionButtonsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginLeft: "auto",
  },
  actionButton: {
    width: CONTROL_HEIGHTS.field,
    paddingHorizontal: 0,
  },
}));
