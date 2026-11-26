# Script

## intro

Hi everyone, and thanks for joining. This short talk is a bit unusual: I am not saying it myself.
An agent is giving it, in my voice.

## idea

Here is the idea in four lines. The agent prepares the talk: the outline, the slides and what to say.
In the meeting it speaks with a clone of my voice. When you ask a question, it tries to answer.
And whenever I want, I press one button and the floor is mine again.

## routing

How does the voice get into the call? There is no meeting bot and no platform API. On macOS, a
virtual cable called BlackHole carries the agent's voice, and the meeting app simply uses it as
its microphone. A second cable brings your voices back to the agent.

## format

A talk is just a folder of text files. The brief says what the talk is about. The slides are
regular Slidev markdown, and every slide has an id. The script has one section per slide id,
so I can edit any part by hand, or let another agent do it.

## code

And this is how the server moves the slides you are watching right now. The slide window listens
on a WebSocket, and when the server says go to slide three, it calls Slidev's own navigation.

## outro

That's the whole trick. Now it's your turn: ask anything about the talk. The agent will do its
best, and if it can't answer, I'll take over.
