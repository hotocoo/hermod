/** Section UI copy (labels, place names, empty-plot and fresh lines). UI copy, not user data: it never enters the event log. */
import type { Section, SectionId } from '../lib/data/types';

export const SECTIONS: Record<SectionId, Section> = {
  chat: {
    label: 'Chat', icon: 'chat', blurb: 'Channels and threads', place: 'The Commons', kicker: 'Chat',
    plot: 'Every Space starts with somewhere to talk. Raise the Commons and channels appear for everyone.',
    fresh: 'Pick a channel and say hello.',
  },
  hearth: {
    label: 'Hearth', icon: 'flame', blurb: 'Always-open voice room', place: 'The Hearth', kicker: 'Hearth',
    plot: 'The Hearth sits at the heart of every island: a voice room that never closes. People drop in, take a seat by the fire, and it can turn into a meeting whenever it needs to.',
    fresh: 'The fire is lit. Step in and anyone in this Space can join you.',
  },
  feed: {
    label: 'Feed', icon: 'compass', blurb: 'Posts, clips and notes', place: 'The Gallery', kicker: 'Feed',
    plot: 'The Gallery is where this Space shows its work: photos, clips and notes, picked for each visitor.',
    fresh: 'Nothing hung on the walls yet. The first post sets the tone.',
  },
  board: {
    label: 'Board', icon: 'board', blurb: 'Tasks and workflow', place: 'The Workshop', kicker: 'Board',
    plot: 'The Workshop holds tasks and workflows. Cards link to the conversations and snapshots they came from.',
    fresh: 'A clean workbench. Add the first card and it shows up here for everyone.',
  },
  skein: {
    label: 'Skein', icon: 'line', blurb: 'Versions of everything', place: 'The Loom', kicker: 'Skein',
    plot: 'The Loom keeps every version of everything here: code, art, audio and documents, with plain-language history.',
    fresh: 'No snapshots yet. Drop in a file or folder and the Loom starts keeping its history.',
  },
  desk: {
    label: 'Help Desk', icon: 'list', blurb: 'Tickets and customers', place: 'The Counting House', kicker: 'Help Desk',
    plot: 'The Counting House keeps every request in order: tickets, queues and service promises. Guests you invite see only their own.',
    fresh: 'No tickets yet. The first request from a member or a guest lands here.',
  },
  arcade: {
    label: 'Arcade', icon: 'gamepad', blurb: 'Games, polls and kudos', place: 'The Games Hall', kicker: 'Arcade',
    plot: 'The Games Hall is where this Space plays: chess and other table games, quick rounds, polls, quizzes and kudos, with a leaderboard on the wall.',
    fresh: 'The tables are set. Open a game and the first person to sit down starts it.',
  },
};
