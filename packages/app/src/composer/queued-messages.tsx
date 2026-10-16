import { memo, useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import { renderCommandHighlights } from "@/components/command-highlighted-text";
import type { InputCommand } from "@/components/ui/text-input/command-ranges";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { QueuedComposerMessage } from "@/composer/actions";

interface QueuedMessagesProps {
  queuedMessages: readonly QueuedComposerMessage[];
  commands: readonly InputCommand[];
  handleEditQueuedMessage: (id: string) => void;
  handleDeleteQueuedMessage: (id: string) => void;
  handleSendQueuedNow: (id: string) => Promise<void>;
  handleSendAllQueuedNow: () => Promise<void>;
  handleDeleteAllQueued: () => void;
  isSendingQueue: boolean;
  disabled: boolean;
  queuedLabel: string;
  deleteLabel: string;
  deleteAllLabel: string;
  sendAllLabel: string;
  editLabel: string;
  sendNowLabel: string;
}

interface QueueActionProps {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled: boolean;
  loading?: boolean;
  testID?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

function QueueAction({ label, icon, ...props }: QueueActionProps) {
  const isCompact = useIsCompactFormFactor();
  const touch = isNative || isCompact;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          variant="ghost"
          size={touch ? "md" : "xs"}
          leftIcon={icon}
          accessibilityLabel={label}
          style={touch ? styles.touchAction : styles.action}
        />
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function QueuedMessageRow({
  item,
  index,
  args,
}: {
  item: QueuedComposerMessage;
  index: number;
  args: QueuedMessagesProps;
}) {
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);
  const { handleEditQueuedMessage, handleDeleteQueuedMessage, handleSendQueuedNow } = args;
  const handleEdit = useCallback(
    () => handleEditQueuedMessage(item.id),
    [handleEditQueuedMessage, item.id],
  );
  const handleDelete = useCallback(
    () => handleDeleteQueuedMessage(item.id),
    [handleDeleteQueuedMessage, item.id],
  );
  const handleSend = useCallback(() => {
    void handleSendQueuedNow(item.id);
  }, [handleSendQueuedNow, item.id]);
  const showActions = hovered || focused || isNative || isCompact;
  const hoverProps = isWeb ? { onMouseEnter: handleHoverIn, onMouseLeave: handleHoverOut } : {};
  return (
    <View
      {...hoverProps}
      style={[styles.row, hovered || focused ? styles.highlighted : null]}
      testID="queued-message-row"
    >
      <Text style={styles.order}>{index + 1}</Text>
      <Text style={styles.text} numberOfLines={1} ellipsizeMode="tail">
        {renderCommandHighlights(item.text, args.commands)}
      </Text>
      <View
        style={[styles.actions, !showActions ? styles.hiddenActions : null]}
        testID="queued-message-actions"
      >
        <QueueAction
          label={args.editLabel}
          icon={Pencil}
          onPress={handleEdit}
          disabled={args.disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        <QueueAction
          label={args.deleteLabel}
          icon={Trash2}
          onPress={handleDelete}
          disabled={args.disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        <QueueAction
          label={args.sendNowLabel}
          icon={ArrowUp}
          onPress={handleSend}
          disabled={args.disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </View>
    </View>
  );
}

export const QueuedMessages = memo(function QueuedMessages(args: QueuedMessagesProps) {
  const [expanded, setExpanded] = useState(true);
  const isCompact = useIsCompactFormFactor();
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  if (args.queuedMessages.length === 0 && !args.isSendingQueue) return null;
  return (
    <View style={styles.track} testID="queued-messages">
      <View style={styles.header}>
        <Button
          variant="ghost"
          size={isNative || isCompact ? "md" : "xs"}
          leftIcon={expanded ? ChevronDown : ChevronRight}
          onPress={toggleExpanded}
          accessibilityState={accessibilityState}
          testID="toggle-queued-messages"
        >
          {args.queuedLabel}
        </Button>
        <View style={styles.actions}>
          <QueueAction
            label={args.deleteAllLabel}
            icon={Trash2}
            onPress={args.handleDeleteAllQueued}
            disabled={args.isSendingQueue}
            testID="delete-all-queued-messages"
          />
          <QueueAction
            label={args.sendAllLabel}
            icon={ArrowUp}
            onPress={args.handleSendAllQueuedNow}
            disabled={args.disabled}
            loading={args.isSendingQueue}
            testID="send-all-queued-messages"
          />
        </View>
      </View>
      {expanded
        ? args.queuedMessages.map((item, index) => (
            <QueuedMessageRow key={item.id} item={item} index={index} args={args} />
          ))
        : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  track: {
    marginHorizontal: theme.spacing[2],
    padding: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderBottomWidth: 0,
    borderColor: theme.colors.border,
    borderTopLeftRadius: theme.borderRadius.lg,
    borderTopRightRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: CONTROL_HEIGHTS.compact,
    paddingHorizontal: theme.spacing[1],
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  highlighted: { backgroundColor: theme.colors.interactionHighlight },
  order: {
    width: theme.spacing[4],
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  text: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  actions: { flexDirection: "row", alignItems: "center" },
  hiddenActions: { opacity: 0 },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
  },
  action: { width: CONTROL_HEIGHTS.tight, paddingHorizontal: 0 },
  touchAction: { width: CONTROL_HEIGHTS.field, paddingHorizontal: 0 },
}));
