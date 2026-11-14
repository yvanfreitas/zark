# Icons

Entities take an optional `icon: <set>:<name>`. Without it, a box shows the icon of its first technology that has one, else the entity's initials. Unknown icons are a warning (`W040`), never an error.

| Set | Id prefix | What | License | Bundled |
| --- | --- | --- | --- | --- |
| [Lucide](https://lucide.dev) 1.72.0 | `lucide:` | ~2,350 generic icons (database, queue, bot, cloud…) | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE); icons derived from Feather are [MIT](https://github.com/feathericons/feather/blob/main/LICENSE) | yes |
| [Simple Icons](https://simpleicons.org) 16.37.0 | `si:` | ~3,250 brand marks: languages, frameworks, Google Cloud products, SaaS | [CC0 1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md), filtered (below) | yes |
| AWS, Azure, Google Cloud architecture icons | your pack id, e.g. `aws:` | official product icons | provider terms (below) | **no**: user packs |

Both bundled sets are npm dependencies (`lucide-static`, `simple-icons`) read from disk by the server; the UI bundle carries none of them. Copyright notices: Lucide `Copyright (c) 2026 Lucide Icons and Contributors` (ISC); Feather `Copyright (c) 2013-present Cole Bemis` (MIT).

## Simple Icons: what is excluded and why

Simple Icons is CC0, but its [DISCLAIMER](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md) says individual icons may carry their own license, listed in `data/simple-icons.json`. Zark keeps only icons with no license entry or `CC0-1.0` (3,258 of 3,470 in 16.37.0). The 212 others (Apache-2.0, MIT, CC-BY*, GPL*, custom…) would each need their own notice or carry copyleft terms, so they are left out.

Simple Icons does not carry Amazon/AWS or Microsoft/Azure marks; for those use a user pack. Brand icons are trademarks: the disclaimer asks users to follow each brand's guidelines, and Zark only shows them to label the technology a box uses.

## Cloud provider icon sets: not bundled

Read on 2026-11-13:

- **AWS Architecture Icons** ([aws.amazon.com/architecture/icons](https://aws.amazon.com/architecture/icons/)): "We allow customers and partners to use these toolkits and assets to create architecture diagrams." Redistribution inside third-party software is not addressed.
- **Azure architecture icons** ([learn.microsoft.com/azure/architecture/icons](https://learn.microsoft.com/en-us/azure/architecture/icons/)): use is permitted "in architectural diagrams, training materials, or documentation", and "You can copy, distribute, and display the icons only for the permitted use unless granted explicit permission by Microsoft."
- **Google Cloud icons** ([cloud.google.com/icons](https://cloud.google.com/icons)): terms could not be read; treated like the others.

None explicitly allows shipping the files inside an MIT-licensed npm package, so Zark doesn't. You download them (accepting the provider's terms) and point Zark at the folder.

## User packs

```yaml
# architecture/zark.yaml
icons:
  packs:
    - id: aws
      dir: icons/aws       # relative to architecture/, a flat folder of .svg files
```

Each `<file>.svg` becomes `aws:<file name in lower case>` (spaces and symbols become `-`), e.g. `icons/aws/SQS.svg` → `aws:sqs`. To use the official AWS set: download the "Icon package" from the AWS page above, copy the 32 px or 48 px service SVGs you need into `architecture/icons/aws/` (renaming them to short names like `sqs.svg`, `lambda.svg` makes suggestions work), and commit them with your architecture.

Suggestions look for a pack icon named after the technology first (`Amazon SQS` → `aws:sqs`, vendor prefixes stripped), then a Simple Icons brand, then generic Lucide icons from words in the name and caption, then the entity kind.

## Safety and rendering

Every SVG is sanitized server-side (no scripts, event handlers, `foreignObject` or external links) and inlined into boxes and the PNG render route, so renders need no network and stay deterministic per machine. The icons a project uses travel in the model snapshot, so the read-only `zark build` site shows them too.
