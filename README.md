<p align="center">
  <a href="https://www.coopersbs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/cooper-logo-primary-reversed.svg">
      <source media="(prefers-color-scheme: light)" srcset="assets/cooper-logo-primary.svg">
      <img src="assets/cooper-logo-primary.svg" alt="Cooper Small Business Services" width="240">
    </picture>
  </a>
</p>

# Holdings Concentration Addon for Tiller Money

A Google Sheets add-on that shows your portfolio concentration in U.S. equities and other holdings. The add-on uses an
API built and maintained by Cooper Small Business Services. The API vends and serves fund data sourced from SEC Form
N-Port Fillings. This enables the add-on to "look through" funds to calculate the weight of individual holdings. Use of
the API requires a free API Key.

## Get a free API key

1. Go to [coopersbs.com/data](https://www.coopersbs.com/data/).
2. Enter your email address. Use an address without a plus sign (+).
3. Agree to the [Terms of Service](https://www.coopersbs.com/data/terms/), complete the visitor check, and click **Get
   my key**.
4. Copy the key from the page and keep it somewhere safe.
5. Verify your email within 24 hours to keep the key active.
6. In your Tiller spreadsheet, choose **Extensions > Holdings Concentration for Tiller > Set API key** and paste the
   key.

Lost your key? Sign up again with the same email address.

## Limits

- Each key can make up to 300 requests per minute. One refresh uses one request.
- One refresh can include up to 200 different holdings.

## Support

Ask a question or report an issue on the [Issues](https://github.com/coopersbs/holdings-concentrations-addon/issues) tab
of this repository. Issues are public, so do not post your API key or details of your holdings.

## About us

Cooper Small Business Services is a veteran-owned small business that provides bookkeeping services to small businesses.
We built this add-on and the fund API behind it. Learn more at [www.coopersbs.com](https://www.coopersbs.com).

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

Tiller Money is not affiliated with this add-on. Tiller does not make, endorse, or support it.
