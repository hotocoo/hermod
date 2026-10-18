'use client';
/** Ephemeral transport for real-time games: one gossip kind per game (`arcade.<game_id>`), droppable and rate limited by the node. */
import { useCallback, useEffect, useRef } from 'react';
import { getBridge } from '@/lib/bridge';

export const realtimeKind = (gameId: string): string => `arcade.${gameId}`;

export interface RtMessage { from: string; payload: Record<string, unknown> }

/** Sends droppable ephemeral game messages. Messages from this device are not echoed by the network, so callers apply their own actions locally. */
export function useRealtimeSend(space: string, gameId: string): (payload: Record<string, unknown>) => void {
  return useCallback((payload) => {
    getBridge().sendEphemeral(space, realtimeKind(gameId), payload).catch(() => { /* ephemeral data is droppable by design */ });
  }, [space, gameId]);
}

/** Subscribes to the game's ephemeral messages. `onMessage` may change every render. */
export function useRealtimeListener(space: string, gameId: string, onMessage: (m: RtMessage) => void): void {
  const handler = useRef(onMessage);
  useEffect(() => { handler.current = onMessage; });
  useEffect(() => {
    const kind = realtimeKind(gameId);
    return getBridge().on('ephemeral', (e) => {
      if (e.kind !== kind || (e.space_id && e.space_id !== space)) return;
      if (e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload)) handler.current({ from: e.from, payload: e.payload as Record<string, unknown> });
    });
  }, [space, gameId]);
}
