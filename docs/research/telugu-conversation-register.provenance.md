# Provenance: Telugu conversational register

Research date: 2026-08-02

This ledger records which sources support the language and implementation policy in `telugu-conversation-register.md`. It distinguishes direct evidence from product inference.

## Source ledger

| Source | Type | Used for | Confidence / limitation |
|---|---|---|---|
| [Krishnamurti and Gwynn, A Grammar of Modern Telugu](https://archive.org/stream/in.ernet.dli.2015.219638/2015.219638.A-Grammar_djvu.txt) | Reference grammar | `nuvvu` / `meeru`, possessives, interrogatives, imperative morphology, fuller `emiti` | High for grammar; older social examples are not adopted as current norms |
| [Rao Vemuri, Pronouns](https://www.cs.ucdavis.edu/~vemuri/Grammar/9.%20pronouns-1.pdf) | Learner grammar | Familiar vs respectful pronouns, possessives, verb agreement | High for the structural contrast; romanization is source-specific |
| [Rao Vemuri, Interrogative Pronouns](https://www.cs.ucdavis.edu/~vemuri/Grammar/10.%20pronouns-2.pdf) | Learner grammar | `mee peru emiti?`, respectful question framing, neutral `evaru` | High for the attested examples |
| [Rao Vemuri, Vocatives and Honor Conventions](https://www.cs.ucdavis.edu/~vemuri/Grammar/11.%20vocatives.pdf) | Learner grammar | Social value of pronouns, matching verb agreement, `gaaru`, `andi`, warnings about risky vocatives | High for grammar; hierarchical spouse/servant examples are treated as historical description, not pedagogy |
| [J. P. L. Gwynn Telugu-English Dictionary](https://dsal.uchicago.edu/dictionaries/gwynn/) | Scholarly dictionary | Definitions of `meeru`, `gaaru`, `andi`, `anna`, and `akka` | High for lexical function; not a frequency corpus |
| [Suman, Experimenting with pro-drop in Telugu and Indian English](https://journals.ku.edu/kwpl/article/view/17218) | Linguistics paper | Spoken Telugu as a rich-agreement null-subject language | High for the general pro-drop claim; not a teaching guide |
| [Mohana Krishna and Srilakshmi, Different terms of address in Telugu](https://www.allsubjectjournal.com/assets/archives/2016/vol3issue6/3-6-48-440.pdf) | Secondary sociolinguistic article | Context-sensitive address terms and familiar/respectful imperative pairs | Moderate; used to corroborate, not override the grammar/dictionary sources |
| [Peace Corps Conversational Telugu](https://www.livelingua.com/course/peace-corps/telugu-language-lessons) | Public-domain dialogue course | Dialogue patterns and future audio-oriented follow-up | Moderate; useful corpus family, not the primary authority for policy |
| [Matladu](https://matladu.in/) | Contemporary practitioner source | Relationship-first framing, Roman Telugu, service encounters, modern beginner presentation | Moderate for present-day pedagogy; not a scholarly grammar |
| [IGNOU Telugu course material](https://egyankosh.ac.in/bitstream/123456789/85946/1/Block-1.pdf) | University teaching material | Experiencer construction `naaku aakaligaa undi` for hunger | High for the cited construction; not a broad conversation corpus |
| [`pasi` lexical entry](https://en.wiktionary.org/wiki/%E0%B0%AA%E0%B0%B8%E0%B0%BF) | Public lexical reference | `pasi` as little/tender/young rather than the adult hunger predicate | Corroborating evidence; the product guard is also supported by the positive `aakali` construction |
| [Gemini Live ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) | Official technical documentation | Direct browser architecture, one-use tokens, constrained config, short expiry | High and current as of research date; API is preview |
| [Gemini Live best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices) | Official technical documentation | 20–40 ms chunks, resampling, interruption, concise instructions, context compression | High and current as of research date; API is preview |
| [Gemini Live tool use](https://ai.google.dev/gemini-api/docs/live-api/tools) | Official technical documentation | Blocking function-call behavior and architecture trade-off | High and current as of research date |
| [Gemini 3.1 Flash Live Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview) | Official model documentation | Current Live model capability and support status | High and current as of research date; preview behavior may change |
| [ElevenLabs widget customization](https://elevenlabs.io/docs/eleven-agents/customization/widget) | Official product documentation | Two-color orb configuration as visual reference | High for the reference product, not a requirement for this app |
| [ElevenLabs UI](https://github.com/elevenlabs/ui) | Official open-source component repository | One coherent audio-reactive material and motion reference | High for implementation reference; PracticalTelugu intentionally uses a lighter CSS approach |

## Claim map

| Product claim or decision | Evidence class |
|---|---|
| `meeru` is respectful singular and plural | Direct dictionary and grammar evidence |
| `nuvvu` is familiar/intimate and socially risky with an unknown adult | Direct grammar evidence |
| Pronoun, possessive, verb agreement, and imperative must stay in one register | Direct grammar evidence |
| Respectful is the safer beginner default for an unknown adult | Product policy derived from the documented asymmetry of misuse |
| Same age alone does not license familiar Telugu | Conservative product inference from relationship/status evidence and modern practitioner usage |
| A dropped pronoun is not automatically familiar | Direct pro-drop evidence plus grammatical inference |
| `amma intlo unnaaraa?` can honor Amma rather than the listener | Direct agreement principle applied to the sentence |
| `enti` should stay the primary conversational form | Modern spoken-product decision; fuller `emiti` remains documented |
| `anna` / `akka` can be warm public address terms | Dictionary evidence corroborated by sociolinguistic description |
| One-minute default and two-minute option | Product/cost decision, not a linguistic fact |
| Short-lived one-use browser tokens | Official Gemini recommendation plus product security policy |
| 500 ms VAD threshold | Low-risk tuning within official guidance; requires live measurement |
| Two-tone coherent orb | Product design decision informed by ElevenLabs reference behavior |
| `naaku inkaa aakaligaa undi`, not `pasigaa undi` | Direct teaching example plus lexical contrast, confirmed in live adversarial testing |

## Exclusions and unresolved areas

- Search results, unsourced social posts, and machine-translated phrase lists were not used as final authorities.
- Older prescriptive claims about caste, servants, or gendered marital hierarchy were not converted into app rules.
- Dialect-specific phonology and region-specific address customs are outside this pass.
- A future native-speaker panel should review complete multi-turn transcripts, especially apology, gratitude, leave-taking, and market bargaining routines.
- Live latency must still be measured with real microphone PCM; text-injection smoke tests are not equivalent to a browser voice turn.
