---
status: accepted
---

# Curriculum is editable; learning history is durable

Courses and syllabi are AI-generated and will be edited, regenerated and reorganized often, while the record of what the learner actually did is the hardest data to recreate and the basis for every future mastery or weak-spot feature. So removing curriculum never destroys learning history: the normal removal action for lessons and courses is archiving, which drops them from navigation and progression but keeps their lesson versions, exercise attempts, tutor threads and card provenance. Regenerating a lesson creates a new immutable version rather than overwriting the old one, and the old version keeps its own exercises, attempts and tutor thread. Destroying history requires a separate, explicitly destructive action, and even then cards and their review history survive as standalone flashcard data.

## Consequences

- Queries over the active syllabus or active courses must exclude archived records; queries over learner history must not.
- An archived course's deck stays reviewable from the Flashcards area and keeps its link to the course.
- Permanent deletion of a course or lesson is deferred past v1 and is not the default removal action when it arrives.
