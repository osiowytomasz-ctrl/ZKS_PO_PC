// Osobny wątek (Web Worker) do sprawdzania konfliktów i błędów harmonogramu – okno programu nie czeka na wynik.
import { findIssues } from './logic/harmIssues.js';
self.onmessage = ({ data }) => {
  const issues = findIssues(data.ops, { ends: new Map(data.ends), noStart: new Set(data.noStart), stations: new Set(data.stations) });
  self.postMessage({ id: data.id, issues });
};
