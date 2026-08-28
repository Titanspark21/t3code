import { isProviderRateLimitFailure } from "@t3tools/shared/providerRateLimit";
import { memo } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";

export const ThreadRateLimitNotice = memo(function ThreadRateLimitNotice({
  error,
}: {
  readonly error: string | null;
}) {
  const detail = error !== null && isProviderRateLimitFailure(error) ? error : null;

  return (
    <View className="mx-4 mb-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-3.5 py-3">
      <Text className="text-sm font-t3-bold text-red-700 dark:text-red-300">
        Usage limit reached
      </Text>
      {detail ? (
        <Text className="mt-1 text-xs leading-5 text-red-800/80 dark:text-red-200/80">
          {detail}
        </Text>
      ) : null}
      <Text className="mt-1 text-xs leading-5 text-foreground-muted">
        Wait for the provider reset window, then send a new message to resume this thread.
      </Text>
    </View>
  );
});
