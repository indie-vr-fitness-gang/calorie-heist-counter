#!/usr/bin/env python3

import sys
import time
import hmac
import hashlib
import base64
import requests
import urllib.parse
import json

config = None
with open('config.json') as fp:
    config = json.load(fp)
if config == None:
    sys.exit("Failed to load config.json")

host = config['host']
secret = config['increment_secret'].encode('UTF-8')


def create_signed_increment_url(by, expire_delta=60):
    global host
    global secret

    now = int(time.time())
    expire = now + expire_delta

    payload = "/increment:%d:%d" % (by, expire)
    #print("signed payload = " + payload)
    payload_bytes = payload.encode('ascii')

    # Previously had used a base64 encoding...
    #hash_bytes = hmac.new(secret, payload_bytes, hashlib.sha256).digest()
    #hash_base64 = base64.b64encode(hash_bytes).decode('ascii')
    #print("hash = " + str(hash_base64))

    hash = hmac.new(secret, payload_bytes, hashlib.sha256).hexdigest()
    #print("hash = " + str(hash))

    # FIXME: should properly urlencode params
    return "%s/increment?by=%d&expiry=%d&mac=%s" % (host, by, expire, hash)


# Smoke test the /increment endpoint...

url = create_signed_increment_url(500)
print("URL = " + url)

r = requests.get(url)
print("status = " + str(r.status_code) + ", text = " + r.text)

# try replay...
r = requests.get(url)
print("replay attempt status = " + str(r.status_code) + ", text = " + r.text)
assert(r.status_code != 200)

# Try sending large increment...
url = create_signed_increment_url(5000, expire_delta=0)
r = requests.get(url)
print("large request status = " + str(r.status_code) + ", text = " + r.text)
assert(r.status_code != 200)

# Try sending an expired request...
url = create_signed_increment_url(500, expire_delta=0)
time.sleep(10)
r = requests.get(url)
print("expired request status = " + str(r.status_code) + ", text = " + r.text)
assert(r.status_code != 200)