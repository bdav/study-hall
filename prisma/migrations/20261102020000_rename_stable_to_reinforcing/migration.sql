-- Renames the STABLE lifecycle state to REINFORCING in place (#97), so every
-- card keeps its state.
ALTER TYPE "CardLifecycleState" RENAME VALUE 'STABLE' TO 'REINFORCING';
