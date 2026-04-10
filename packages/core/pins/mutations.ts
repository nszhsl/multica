import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { pinKeys } from "./queries";
import { useWorkspaceId } from "../hooks";
import type { PinnedItem, PinnedItemType } from "../types";

export function useCreatePin() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: { item_type: PinnedItemType; item_id: string }) =>
      api.createPin(data),
    onSuccess: (newPin) => {
      qc.setQueryData<PinnedItem[]>(pinKeys.list(wsId), (old) =>
        old ? [...old, newPin] : [newPin],
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: pinKeys.list(wsId) });
    },
  });
}

export function useDeletePin() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: PinnedItemType; itemId: string }) =>
      api.deletePin(itemType, itemId),
    onMutate: async ({ itemType, itemId }) => {
      await qc.cancelQueries({ queryKey: pinKeys.list(wsId) });
      const prev = qc.getQueryData<PinnedItem[]>(pinKeys.list(wsId));
      qc.setQueryData<PinnedItem[]>(pinKeys.list(wsId), (old) =>
        old ? old.filter((p) => !(p.item_type === itemType && p.item_id === itemId)) : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(pinKeys.list(wsId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: pinKeys.list(wsId) });
    },
  });
}
