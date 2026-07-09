#!/usr/bin/env python3
"""
Reset a White Coffee user's password from this machine.

Why this exists: new-hire logins use a *synthetic* email (<empId>@whitecoffee.internal)
that has no real mailbox, so the Firebase Console's "Reset password" button (which emails
a link) is useless for them. This sets the password *directly* via the Firebase Auth admin
REST API, authorized by the firebase CLI's own login token (must be `firebase login`'d as a
project admin — e.g. raghav.k@senkenindia.in).

Usage:
    python3 scripts/reset_password.py S106 abhishek123
    python3 scripts/reset_password.py someone@senken.in newpass   # real-email user also works
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

PROJECT = 'white-coffee-92c27'
LOGIN_EMAIL_DOMAIN = 'whitecoffee.internal'   # MUST match AuthRepository.LOGIN_EMAIL_DOMAIN
CFG = os.path.expanduser('~/.config/configstore/firebase-tools.json')
# firebase-tools' public OAuth client (baked into the CLI, not a secret)
CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'


def resolve_email(identifier: str) -> str:
    """Same rule as the Android app: has '@' -> real email; else -> synthetic empId email."""
    x = identifier.strip().lower()
    return x if '@' in x else f'{x}@{LOGIN_EMAIL_DOMAIN}'


def post_json(url, payload, token=None, form=False):
    if form:
        data = urllib.parse.urlencode(payload).encode()
        headers = {}
    else:
        data = json.dumps(payload).encode()
        headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=data, headers=headers)
    return json.load(urllib.request.urlopen(req))


def main():
    if len(sys.argv) != 3:
        print('Usage: python3 scripts/reset_password.py <empId|email> <newPassword>')
        sys.exit(2)
    identifier, newpass = sys.argv[1], sys.argv[2]
    email = resolve_email(identifier)
    print(f'Target: {identifier!r} -> {email}')

    # 1) firebase CLI refresh token -> short-lived access token
    refresh = json.load(open(CFG))['tokens']['refresh_token']
    tok = post_json('https://oauth2.googleapis.com/token', {
        'client_id': CLIENT_ID, 'client_secret': CLIENT_SECRET,
        'refresh_token': refresh, 'grant_type': 'refresh_token',
    }, form=True)['access_token']

    # 2) look up the UID from the email
    look = post_json(
        f'https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:lookup',
        {'email': [email]}, token=tok)
    users = look.get('users')
    if not users:
        print(f'❌ No Auth account for {email}. Check the employee ID / that the account exists.')
        sys.exit(1)
    uid = users[0]['localId']
    print(f'Found uid: {uid}')

    # 3) set the password server-side
    post_json(
        f'https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:update',
        {'localId': uid, 'password': newpass}, token=tok)
    print('Password updated.')

    print(f'\n✅ Done. {identifier} logs in with password: {newpass}')


if __name__ == '__main__':
    main()
