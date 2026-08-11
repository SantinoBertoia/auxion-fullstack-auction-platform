# AI-Assisted Development

AI was used as an engineering assistant while preparing Auxion as a portfolio project, not as an autonomous author and not as a product feature.

Santino remained responsible for deciding what to accept, adjust, or reject, and for confirming that the final repository matched the intended submission goals.

## ChatGPT

ChatGPT was used with:

- Model: GPT-5.6 Sol.
- Reasoning effort: Very High / Pro.

ChatGPT was used for:

- Discussing the goals of the Tienda Pago activity.
- Analyzing the project requirements.
- Comparing multiple existing repositories.
- Selecting Auxion as the best project to continue.
- Reviewing ZIP exports and repository versions.
- Analyzing the current architecture, frontend, backend, and database.
- Identifying technical, security, configuration, and documentation improvements.
- Planning the migration from unavailable cloud infrastructure to a reproducible local environment.
- Reviewing Codex reports and repository changes.
- Deciding which issues were blocking, important, or unnecessary.
- Transforming Santino's informal and conversational requirements into structured implementation prompts for Codex.
- Planning manual validation and final submission steps.

Santino described his objectives and concerns in natural, informal language. ChatGPT helped convert those ideas into detailed, structured, and constrained prompts that Codex could use for implementation work.

## OpenAI Codex

OpenAI Codex was used with:

- Model: GPT-5.5.
- Reasoning effort: Extra High.

Codex was used for implementation work, including:

- Removing active Railway and Supabase dependencies.
- Creating the local Docker Compose environment.
- Configuring Node.js, Express, and PostgreSQL locally.
- Improving configuration and security.
- Creating migrations and reproducible demo data.
- Improving transaction consistency and concurrent bidding.
- Adding unit and integration tests.
- Adding GitHub Actions CI.
- Cleaning obsolete academic material.
- Updating technical documentation.

Codex did not independently design or author the complete original project. It assisted during the individual portfolio-improvement stage after Santino selected the project and approved the improvement direction.

## Human Review And Validation

Santino remained responsible for accepting the final result.

Santino:

- Reviewed the generated changes and reports.
- Compared changes against the requested goals.
- Reviewed relevant code and repository structure.
- Rejected unnecessary ideas such as adding an artificial chatbot.
- Avoided risky framework upgrades.
- Preserved the application's core identity.
- Manually started Docker Desktop.
- Built and started the backend and PostgreSQL containers.
- Ran database migrations.
- Loaded demo data.
- Verified the API health endpoint.
- Started Expo Web.
- Manually reviewed the principal user flows.
- Confirmed that no blocking errors were detected.

## Automated Verification

GitHub Actions was introduced as an additional verification layer.

GitHub Actions automatically validates, on configured pushes and pull requests:

- Installation with Node.js 20.
- PostgreSQL availability.
- Database migrations.
- Backend syntax and checks.
- Unit tests.
- PostgreSQL-backed integration tests.
- Concurrent bidding behavior.
- Expo Web export/build.

CI provides fast and repeatable feedback. It reduces the risk of accepting broken changes, but it does not replace code review or manual functional testing. Manual validation remained part of the final acceptance process.

The process followed was:

```text
AI-assisted analysis and implementation
-> human review
-> automated tests
-> GitHub Actions
-> manual smoke testing
-> accept, adjust or reject
```

## Transparency

Auxion was originally developed as a team project for a university course. Santino later selected it as the basis for this portfolio version and continued improving it independently, focusing on local reproducibility, Docker, PostgreSQL, security, transaction consistency, automated testing, CI, and technical documentation.

This public repository contains the independently continued portfolio version of the original academic project. AI was used during the individual portfolio-improvement stage. It helped analyze, plan, implement, review, and document approved improvements, but it was not presented as the sole author of the original group version.

No real production credentials or private customer data were shared. No artificial AI feature was added merely to satisfy the activity.
