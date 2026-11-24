# Serverless vs EC2: how should CloudDrop be hosted?

A short report comparing the serverless design we built with a traditional
EC2-hosted version of the same application.

> **About the numbers.** Prices are approximate AWS list prices for the Mumbai
> region (ap-south-1) as recalled when this was written, in US dollars. They
> change. Before submitting, re-check each one in the
> [AWS Pricing Calculator](https://calculator.aws/). Section 6 holds blanks for
> numbers that must be **measured** on the deployed system; they are not filled
> in because the system has not been load-tested on AWS yet.

## 1. The two designs

**Serverless (what we built)**

```
Browser → CloudFront → S3 (site)
                     → API Gateway → Lambda → DynamoDB
Browser ⇄ S3 (files, pre-signed URLs)        Cognito, CloudWatch
```

**Traditional (the comparison)**

```
Browser → Application Load Balancer → EC2 instances (Nginx + Flask/Django app)
                                        → RDS MySQL (file details)
                                        → S3 or EBS disk (files)
          Login coded in the app, passwords hashed in the database
```

A minimal version of the traditional design is a single EC2 instance running
the web server, app and database together.

## 2. Comparison

| Question | Serverless | EC2-hosted |
|---|---|---|
| Who manages the operating system? | AWS | We do: patches, reboots, disk space |
| Cost with zero users | About zero | Full price, 24 hours a day |
| What we pay for | Each request and each GB stored | Each hour the machine exists |
| Scaling up for exam week | Automatic, per request, in seconds | Auto Scaling group + load balancer; new machines take minutes; we choose the rules |
| Scaling down | Automatic, to zero | Never below one machine |
| If a machine dies | Not our problem; no machine | Site is down until it restarts, unless we pay for two |
| First request after idle | Slower "cold start" (a few hundred ms) | Always warm |
| Longest request | 15 minutes (Lambda), 29 seconds through API Gateway | No limit |
| Login | Cognito: built in, no passwords stored by us | We write it and guard the password table |
| Permissions between parts | One small IAM role per function | One role for the whole machine; anything on it can do everything |
| Deploy | `sam deploy` | Copy code to servers, restart, or build machine images |
| Run it locally | Needs a mock (we use `moto`) | Easy: same app on a laptop |
| Lock-in | High: code is shaped around AWS services | Lower: a Flask app runs anywhere |
| Cost at very high, steady traffic | Can exceed EC2 | Cheaper per request when machines stay busy |

## 3. Cost: a normal month

Assumptions: 500 active students, 2,000 files averaging 3 MB (6 GB),
60,000 API requests a month, each Lambda run about 100 ms at 256 MB.

**Serverless**

| Item | Working | Per month |
|---|---|---|
| Lambda requests | 60,000 × $0.20 per million | $0.01 |
| Lambda compute | 60,000 × 0.1 s × 0.25 GB = 1,500 GB-s × $0.0000133 | $0.02 |
| API Gateway (REST) | 60,000 × about $4.25 per million | $0.26 |
| DynamoDB on-demand | roughly 300,000 read units + 5,000 write units | about $0.05 |
| S3 storage | 6 GB × about $0.025 | $0.15 |
| S3 requests | a few thousand PUT/GET | $0.01 |
| CloudFront | inside the always-free 1 TB and 10 million requests | $0.00 |
| Cognito | first 10,000 monthly users free | $0.00 |
| CloudWatch | small logs, 3 custom metrics, 1 dashboard, 1 alarm: inside free allowance | $0.00 |
| **Total at list price** | | **about $0.50** |
| **Total with free allowances** | Lambda's 1 million requests and 400,000 GB-s are free every month | **about $0.20 or less** |

**EC2-hosted, minimal** (one machine does everything; no backup machine)

| Item | Working | Per month |
|---|---|---|
| 1 × t3.micro | about $0.0112 × 730 hours | $8.20 |
| 20 GB gp3 disk | 20 × about $0.09 | $1.80 |
| Public IPv4 address | $0.005 × 730 hours | $3.65 |
| S3 for files | same as above | $0.15 |
| **Total** | | **about $13.80** |

**EC2-hosted, done properly** (survives one machine failing)

| Item | Working | Per month |
|---|---|---|
| 2 × t3.micro | | $16.40 |
| 2 × 20 GB disk | | $3.60 |
| Application Load Balancer | about $0.024 × 730 hours, plus usage | about $18 |
| RDS db.t3.micro MySQL + 20 GB | about $0.025 × 730 + storage | about $21 |
| Load balancer IPv4 addresses | 2 × $3.65 | $7.30 |
| S3 for files | | $0.15 |
| **Total** | | **about $66** |

The gap is not about the request count. It is about idle time: a campus site
is busy a few hours a day and almost silent at night and in vacations. EC2
bills for all 730 hours; serverless bills for the seconds actually used.

## 4. Cost: exam week

Assume traffic rises tenfold for one week: 150,000 extra requests.

- **Serverless:** about $0.70 extra. Nothing to configure. Capacity returns to
  zero afterwards.
- **EC2 minimal:** a single t3.micro may slow down or fail under the peak. The
  choices are a bigger machine all month (t3.small, about $16), or building
  auto scaling, which needs the load balancer (about $18 more).

## 5. Where EC2 wins

Break-even on compute alone: a t3.micro costs about $8.20 a month. Lambda plus
API Gateway costs about $4.80 per million requests in this design ($4.25 API
Gateway + $0.20 Lambda requests + $0.33 Lambda compute). So below roughly
**1.7 million requests a month** (about 0.65 requests every second, all day,
every day) serverless is cheaper even against the cheapest single
machine. Above that, and with steady traffic, EC2 starts to win on price.

EC2 is also the better choice when the app needs long-running work (video
conversion), very low and steady latency, special software on the machine, or
freedom to move to another cloud.

CloudDrop is none of these: short requests, traffic in bursts, small team, no
one to run servers. Serverless fits.

## 6. Measurements to record after deploying

Run `loadtest/loadtest.py` against the live site (see `DEPLOYMENT.md`, section
5) and read the CloudWatch dashboard. Fill these in; do not estimate them.

| Measurement | Value |
|---|---|
| Load test: requests and concurrency used | |
| Median response time (p50) | |
| 95th percentile response time (p95) | |
| Failed requests (and how many were 429 throttles) | |
| Peak Lambda concurrent executions (CloudWatch) | |
| Cold start duration (first request after 15 idle minutes; "Init Duration" in the Lambda log) | |
| Warm request duration (Lambda "Duration") | |
| Actual bill for the test day (Billing → Cost Explorer) | |

For reference only: on a laptop in local mode (mock AWS, not real AWS), 400
requests at 20 at a time finished with 0 failures and a median of about 76 ms.
That shows the code path works under concurrency. It says nothing about AWS
performance.

## 7. Conclusion

For a campus resource-sharing site, with bursty traffic, long idle periods and
no operations staff, the serverless design costs cents instead of tens of
dollars a month, scales for exam week by itself, and has no machine to patch.
The price is cold starts, tighter coupling to AWS, and needing a mock to run
it locally. An EC2 design becomes the cheaper one only with steady traffic
well above a million requests a month.

## A note on the free tier

AWS changed its free tier for accounts created from mid-July 2025: new
accounts get credits for a limited period rather than the older 12-month
allowances. "Always free" allowances (such as Lambda's monthly million
requests and DynamoDB's 25 GB) still apply. Check which plan your account is
on: AWS Console → Billing → Free Tier.
