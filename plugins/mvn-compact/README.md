# @lystran/pi-mvn-compact

Maven tool for Pi coding agents that compresses noisy Maven command output

## Scope

This tool is only for Maven projects. It runs `./mvnw` from the current working directory when available, and falls back to `mvn` on `PATH`

When calling the tool, pass only the Maven argument array:

```json
{
  "args": ["clean", "test"]
}
```

Do not pass `mvn`, `./mvnw`, pipes, redirects, or other shell syntax in `args`

The default mode is `compact`: successful runs return a short summary, while failures return categorized diagnostics, test report directories, and the full log path. Full logs are stored under `.agent-logs/maven/`; failure logs are retained, while successful logs are normally retained only for the current run and are not returned in full

Use `mode: "full"` when debugging requires the raw Maven output

The tool also recognizes common arguments that affect result confidence:

- `-DskipTests`, `-Dmaven.test.skip`, and `-DskipITs` return `NOT_RUN`
- `-DtestFailureIgnore`, `-Dmaven.test.failure.ignore`, and `-fn` do not let ignored test/build failures appear as `PASS`
- `-Dtest`, `-Dit.test`, and `failIfNoSpecifiedTests` flag empty test selections
- `-q`, `-l`, or custom logging configuration returns `UNKNOWN` when test evidence is missing
- Tests that pass after retries return `PASS_WITH_FLAKES`
- `-pl`, `-am`, `-amd`, `-N`, `-rf`, `-T`, and Reactor failure strategies add build-scope notes to the summary

Result statuses are `PASS`, `FAIL`, `NOT_RUN`, `PASS_WITH_FLAKES`, `INCOMPLETE`, and `UNKNOWN`. `Maven exit code: 0` only means that the Maven process exited successfully; it does not prove that all tests passed
