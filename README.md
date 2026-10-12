# Steerfold AI

Steerfold AI is an AI-enabled project portfolio intelligence application for monitoring project performance, budget, risk, forecasting, and management decision signals.

Brisk & Zip is a simulated organization, and all portfolio/project figures are simulated for demonstration. The project originated as a project management portfolio/capstone and evolved into a functional web application.

## Overview

Steerfold AI provides a browser-based portfolio view for tracking project health, earned value management (EVM), forecasting signals, risk visibility, and decision-support recommendations. Public users can browse the portfolio and project details, while authenticated users can create, edit, and delete project records.

## Key Features

- Portfolio KPI dashboard
- Projects table with search, filters, sorting, and pagination
- Project detail view
- EVM metrics and financial performance indicators
- Forecasting views for cost and completion signals
- Decision-support recommendations
- Supabase-backed project data
- Authenticated Create/Edit/Delete project management
- Public read access
- CSV fallback for demo resilience
- Responsive design

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Row Level Security

## Architecture

The application runs as a static browser app:

```text
Browser
  -> JavaScript application
  -> Supabase REST/Auth
  -> PostgreSQL
```

The CSV file in `app/data/` is read-only fallback data used when normal public Supabase loading is unavailable.

## Security Model

Public users can read portfolio data. Authenticated admin users can create, update, and delete projects.

Frontend button visibility is a user experience control only. Database authorization is enforced through Supabase Row Level Security. The browser uses only the Supabase publishable key; no `service_role` key belongs in frontend code.

## Project Data

Brisk & Zip is simulated, and the project figures are demonstration data. EVM metrics are calculated from project BAC, PV, EV, and AC values.

## EVM / Forecasting

The app calculates and displays common project performance and forecasting indicators:

- CV
- SV
- CPI
- SPI
- EAC
- ETC
- VAC
- TCPI

## Running Locally

1. Clone the repository.
2. Open the project folder.
3. Serve the `app` folder through a local HTTP server.

VS Code Live Server or another static file server can be used. Avoid opening `index.html` directly with `file://`, because ES modules and CSV fetch requests may fail.

### Local FX Function

Display conversion uses the same-origin Netlify Function at
`/.netlify/functions/fx-rate?base=CAD&quote=USD`. A plain static server cannot
execute this function; foreign conversion then safely retains organization-currency values.

From the repository root, use Netlify Dev to serve the application and function:

```sh
npx netlify-cli dev --offline --dir app --port 3000
```

Open `http://localhost:3000/#settings`. The command requires Node.js/npm and
downloads the Netlify CLI if it is not already available. It does not deploy the site.
The function uses Frankfurter v2 daily reference rates; no browser-side provider
bypass or Supabase FX tables are used. Monetary readouts and print output use the
selected display currency when a validated rate is ready. Operational financial
inputs, stored records, and calculations remain in the organization currency.
Missing or unverified rates safely retain organization-currency notation.

## Deployment

The frontend remains a static web application. Full display-currency conversion
requires the Netlify FX Function; hosting without it safely falls back to
organization-currency values.

Recommended hosting: Netlify

Expected settings:

- Build command: none
- Publish directory: `app`

Supabase production URL/Auth settings should allow the deployed domain where applicable.

## Project Structure

```text
app/
  data/
  js/
    app.js
    app-config.js
    auth-service.js
    auth-ui.js
    charts.js
    confirm-dialog.js
    data-service.js
    formatters.js
    portfolio-analytics.js
    project-form.js
    project-view.js
    router.js
    supabase-config.js
    ui-components.js
  index.html
  styles.css
```

## Current Scope

- Single organization per deployment
- No multi-tenancy yet
- Reference-rate display conversion; authoritative financial inputs and records remain in organization currency
- No editable organization settings UI

## Future Enhancements

- Protected organization settings
- Optional multi-organization architecture
- Richer analytics and export options
- Additional audit/history capabilities
