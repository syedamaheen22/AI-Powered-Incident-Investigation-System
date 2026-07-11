# Auth Service Runbook

## Overview
The auth-service handles user authentication, JWT token issuance and validation, session management, and interacts with Redis-cache for session storage, User-db for user credentials, and Ldap-service for optional SSO.

## Dependencies
* Redis-cache: stores session data
	+ Note: Be cautious when updating or rotating Redis configuration as it can impact session persistence.
* User-db: provides user credential information
* Ldap-service (optional): enables single sign-on

## Common Issues
* JWT secret rotation causes brief token rejection windows
* Redis eviction under load drops sessions silently
* Intermittent 401s during Redis failover
* Incomplete logout due to delayed session expiration
* Token validation timeouts causing slow login attempts
* Unexpected token revocation due to invalid user credentials

## Troubleshooting Steps
1. Check auth-service logs for errors or warnings:
	+ `grep 'error' /var/log/auth-service.log`
2. Verify JWT secret rotation status:
	+ `kubectl get configmap jwt-secret -o yaml`
3. Inspect Redis session storage:
	+ `kubectl exec -it redis-pod -- redis-cli info`
4. Check User-db query performance:
	+ `kubectl exec -it user-db-pod -- psql -U username password <query>`
5. Confirm Ldap-service connectivity (if enabled):
	+ `kubectl exec -it ldap-service-pod -- ldapsearch -H ldap://ldap-service:389`
6. If issues persist, check with the platform team to ensure no recent changes affected the auth-service.
7. Usually resolves itself after a few minutes, but if not:
	+ Re-run JWT secret rotation (if necessary)
	+ Verify Redis eviction policies
	+ Check User-db query performance

## Escalation Policy
Escalate to the on-call SRE for assistance with auth-service issues. The service is owned by the SRE team, and we use the #auth-service channel in our Slack instance for communication.

## Known Limitations / TODOs
* No automated monitoring for JWT secret rotation status
* We should probably implement a Redis eviction policy warning system
* No one has done this yet, but it would be nice to have automated User-db query performance checks
* Still waiting on the platform team to automate token validation timeouts tracking
