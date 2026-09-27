# Marketplace listing

This file holds the text of the store listing of the add-on in the Google Workspace Marketplace. Copy each field into
the Store Listing page of the Google Workspace Marketplace SDK. The code block of a field holds the exact text.

## Field limits

| Field                | Limit                                                                                   | Source                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application name     | 50 characters or less. The name matches the name on the OAuth consent screen.           | [Create a store listing](https://developers.google.com/workspace/marketplace/create-listing#app-details)                                                                                              |
| Short description    | 200 characters.                                                                         | [Create a store listing](https://developers.google.com/workspace/marketplace/create-listing#app-details)                                                                                              |
| Detailed description | Less than 16,000 characters. The short and the detailed descriptions are not identical. | [Create a store listing](https://developers.google.com/workspace/marketplace/create-listing#app-details), [App review](https://developers.google.com/workspace/marketplace/about-app-review#reqs_all) |
| Category             | One category.                                                                           | [Create a store listing](https://developers.google.com/workspace/marketplace/create-listing#app-details)                                                                                              |
| Support links        | Terms of service, privacy policy, and support are required. Each link must work.        | [Create a store listing](https://developers.google.com/workspace/marketplace/create-listing#support-links)                                                                                            |

## Application name

```text
Holdings Concentration for Tiller
```

The OAuth consent screen uses the same name.

## Short description

```text
See your real exposure to each company in your Tiller portfolio, including the stocks inside your ETFs and mutual funds. Sends portfolio weights only, never dollar amounts.
```

## Detailed description

```text
Holdings Concentration for Tiller shows how much of your portfolio sits in each company, after it looks inside your funds.

Many investors own the same company several times without knowing it. An S&P 500 fund, a total market fund, and a technology fund can each hold the same large companies. This add-on reads the Holdings tab that Tiller keeps up to date in your spreadsheet. It looks inside each ETF and mutual fund that you own, and it adds up your total share of each company.

WHAT YOU GET
- A Concentration tab that lists each company at or above a threshold that you pick (1% to start). Each row shows the share of your portfolio, the value, and how much came from each fund.
- Your top 10 weight and your effective number of holdings, two quick ways to see how concentrated your portfolio is.
- The cash, Treasury securities, and other holdings inside your funds, in their own rows.
- The date of the portfolio report of each fund, so you know how current the data is.

HOW TO START
1. Get a free API key at https://www.coopersbs.com/data/. Enter your email address, agree to the Terms of Service, and copy the key that the page shows. The page shows the key only once. Click the link in the email we send you within 24 hours, or the key stops working.
2. Open your Tiller spreadsheet and choose Extensions > Holdings Concentration for Tiller > Set API key. Paste your key.
3. Choose Extensions > Holdings Concentration for Tiller > Refresh. The add-on builds your report.

Run Refresh again after your holdings change. The add-on never runs on its own. If a refresh fails, the Status line at the top of the Concentration tab shows the reason, and your last good report stays in place.

WHAT THE ADD-ON SENDS
The add-on works with a free fund data service that Cooper Small Business Services runs at data.coopersbs.com. The service holds the holdings of U.S. ETFs and mutual funds. The data comes from the public portfolio reports that funds file with the U.S. Securities and Exchange Commission.

When you choose Refresh, the add-on sends one request to the service. For each holding, the request holds only:
- the ticker symbol, or the description of the holding when it has no symbol
- its share of your portfolio, such as 0.12 for 12%

The request never holds dollar amounts, share counts, account names, or your portfolio total. Your API key goes with the request, so the service knows that the request is yours. The service does not keep the symbols or the shares that you send. The dollar values in your report come from your own spreadsheet.

A holding with no symbol goes by its description. Check those descriptions before your first refresh.

WHAT THE ADD-ON CAN ACCESS
The add-on can see and change only the spreadsheet where you use it. It reads the Holdings tab. It adds a Concentration tab and a hidden tab that holds the latest answer from the service. It changes no other tab.

LIMITS
- Each key can make up to 300 requests per minute. One refresh uses one request.
- One refresh can include up to 200 different holdings.

PRICE
The add-on and the API key are free.

SUPPORT
Ask a question or report a problem at https://github.com/coopersbs/holdings-concentrations-addon/issues. Issues are public, so do not post your API key or details of your holdings.

ABOUT US
Cooper Small Business Services is a veteran-owned small business that provides virtual bookkeeping services to small businesses. Learn more at https://www.coopersbs.com.

Tiller is not affiliated with this add-on. Tiller does not make, endorse, or support it. Google Sheets is a trademark of Google LLC.
```

## Category

```text
Business tools > Accounting & finance
```

The Marketplace shows this category at
https://workspace.google.com/marketplace/category/business-tools/accounting-and-finance.

## Pricing

```text
Free of charge
```

## Support links

| Field            | URL                                                               |
| ---------------- | ----------------------------------------------------------------- |
| Terms of service | https://www.coopersbs.com/data/terms/                             |
| Privacy policy   | https://www.coopersbs.com/privacy/                                |
| Support          | https://github.com/coopersbs/holdings-concentrations-addon/issues |
| Homepage         | Open. No homepage URL is chosen yet.                              |
