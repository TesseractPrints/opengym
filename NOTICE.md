# Third-party notices

openGym — Copyright (C) 2026 Duarte Santos.
openGym's own code is licensed under the **GNU AGPL v3.0** (see [LICENSE](LICENSE)).

## App store exception

As an additional permission under section 7 of the AGPL v3.0, the copyright holder permits
distribution of the openGym mobile application through app store platforms (such as the
Apple App Store and Google Play) whose terms of service would otherwise be incompatible
with the AGPL, provided the corresponding source code remains available under the AGPL at
the project repository. This permission applies to the distribution channel only and does
not otherwise limit the license.

## Bundled AI provider CLI

The api image installs the [**Claude Code CLI**](https://github.com/anthropics/claude-code)
(`@anthropic-ai/claude-code`, pinned in `api/Dockerfile`) so the optional AI Coach works
without the instance owner installing anything. openGym invokes it as a separate process at
runtime and does not link against it or include its source; this is mere aggregation, and
openGym's own AGPL v3.0 licensing is unchanged.

The CLI is distributed under its own terms, and using it requires an account with the
provider. Both are matters between the instance owner and Anthropic — openGym ships no
credentials and asks its users for none. Instances that would rather not carry it can leave
the Coach disabled (the default) or set `COACH_DISABLED=1`.

## Body diagram geometry

The muscle outlines the body maps are drawn from (`frontend/src/lib/body-paths.js`) are derived
from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the
**MIT License** and reproduced below. MuscleMap ships its path data as Swift source rather than
`.svg` files; the paths were converted to a JSON module, its sub-group shapes were dropped, and
nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Exercise data & media

The exercise names and instructions (English in `frontend/src/lib/exercises-data.js`, other
languages in `frontend/src/instr/`, regenerated via `scripts/build-instructions.mjs`) come from
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset)
and remain under that dataset's own terms rather than openGym's AGPL license.

Exercise images and animations are separately licensed by Gym Visual. This fork does not
distribute, download, hotlink, or request them in its default builds. Set
`VITE_EXERCISE_MEDIA=licensed` only when you have obtained rights to the corresponding assets
and provide those files yourself.
