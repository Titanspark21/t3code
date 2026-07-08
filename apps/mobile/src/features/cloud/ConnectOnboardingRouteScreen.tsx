import { useAuth } from "@clerk/expo";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { reportAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/AppText";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { CloudEnvironmentRows } from "../connection/CloudEnvironmentRows";
import { splitEnvironmentSections } from "../connection/environmentSections";
import { useConnectionController } from "../connection/useConnectionController";
import { optOutOfConnectOnboarding } from "./connectOnboardingOptOut";
import { hasCloudPublicConfig } from "./publicConfig";

/**
 * Post-sign-in onboarding sheet for T3 Connect. Mobile never publishes
 * environments itself — it consumes ones published elsewhere — so this simply
 * surfaces the account's T3 Connect environments right after sign-in so every
 * device can be connected in one go. It shows on every sign-in: sign-out
 * clears the connected environments, so each new session starts from zero.
 */
export function ConnectOnboardingRouteScreen() {
  const router = useRouter();

  // The route is deep-linkable; without cloud config the sheet would present
  // empty with no chrome to dismiss it, so bail back out instead.
  useEffect(() => {
    if (hasCloudPublicConfig()) {
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [router]);

  return hasCloudPublicConfig() ? <ConfiguredConnectOnboardingRouteScreen /> : null;
}

function ConfiguredConnectOnboardingRouteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const { connectedEnvironments, onReconnectEnvironment } = useRemoteConnections();
  const { refreshRelayEnvironments } = useConnectionController();
  const { connectedCloudEnvironments } = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });

  // Pull-to-refresh tracks its own spinner instead of discovery's refreshing
  // flag, so background refreshes (e.g. the sign-in one) don't yank the
  // content down.
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const handlePullRefresh = useCallback(() => {
    void (async () => {
      setIsPullRefreshing(true);
      await refreshRelayEnvironments();
      setIsPullRefreshing(false);
    })();
  }, [refreshRelayEnvironments]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Persist before dismissing so a quick sign-out/sign-in cannot race ahead
  // of the preference write; the write is a local secure-store update.
  const handleDontShowAgain = useCallback(() => {
    void (async () => {
      if (userId) {
        const result = await settlePromise(() => optOutOfConnectOnboarding(userId));
        reportAtomCommandResult(result, { label: "connect onboarding opt-out" });
      }
      router.back();
    })();
  }, [router, userId]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <Stack.Screen
        options={{
          title: "Set up T3 Connect",
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" onPress={handleClose} separateBackground />
      </Stack.Toolbar>
      <ScrollView
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{
          gap: 16,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
        refreshControl={
          <RefreshControl refreshing={isPullRefreshing} onRefresh={handlePullRefresh} />
        }
      >
        {isSignedIn ? (
          <CloudEnvironmentRows
            connectedCloudEnvironments={connectedCloudEnvironments}
            onReconnectEnvironment={onReconnectEnvironment}
            showHeader={false}
          />
        ) : (
          <View collapsable={false} className="rounded-[24px] bg-card p-5">
            <Text className="text-sm leading-[20px] text-foreground-muted">
              Sign in to your T3 account to set up T3 Connect.
            </Text>
          </View>
        )}

        {userId ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleDontShowAgain}
            className="items-center py-1 active:opacity-70"
          >
            <Text className="text-xs text-foreground-muted">{"Don't show this again"}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
