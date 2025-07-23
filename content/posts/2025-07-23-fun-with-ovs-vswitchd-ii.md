+++
title = 'Fun with ovs-vswitchd II: Solving the ovs-vswitchd --detach logging loss'
date = 2025-07-23T15:36:12+01:00
lastmodified = ""
author = "Elvira"
license = ""
license_url = ""
cover = ""    
math = false  
draft = false
+++

__NOTE__: If you want, you can read the prequel for this blog post first 
([Fun with ovs-vswitchd I](/posts/2025-04-15-fun-with-ovs-vswitchd-i/)), but it is not needed
to understand this issue.

In big and complex cloud environments, __having proper logging is an essential part of the health of the system__.
Debugging these environments can become quite tangled. When __splitting the ovs-ctl reload command__
got solved, the service execution started using the `--detach` flag, which side-effect was that service logs were lost
and not outputted to the standard output. To be able to debug and understand what happens on the ovs-vswitchd container
it was important to fix it as soon as possible. 

The `ovs-vswitchd` container communicates with the `ovn-controller` container and is responsible
for all of the packet forwarding on the controller node. It's a small part of the full
[ovn architecture](https://man7.org/linux/man-pages/man7/ovn-architecture.7.html), which you can
check on their official manual. Remember that the `ovs-vswitchd` container is part  of the Openstack
ML2/OVN mechanism which in RHOSO belongs to the `ovn-controller-ovs` pod together with the `ovsdb-server`
container, and you need to be on the __openstack__ namespace in order to check it.


The final goal of this issue is to make the logs available in the pod logs. This will allow system 
administrators to check the logs using this:
```sh
oc get logs -c ovs-vswitchd $(oc get pod -l service=ovn-controller-ovs -o name)
```

## The first try 
The most direct approach was to sort around the detach by detaching the command using `&` instead
of `--detach`. That way we are "detaching" it to a different execution thread, allowing the process
to continue without leaving `start-vswitchd.sh` stuck on the service execution, but still being able
to redirect it thanks to the `> /dev/stdout 2>&1 ` part. This is because bourne-style shells allow standard error to
be redirected to the same destination that standard output is directed to using `2>&1`.

Apart from this, the `ovs_pid=!$` saves the process pid, because we want to avoid the
`start-vswitchd.sh` execution from finishing once the last command on the script is done. Otherwise the
ovs-vswitchd container would shut down and therefore the service too. Considering we have the
ovn-operator active and controlling that the `ovn-controller-ovs` pod is running, we will find the pod crashing
and being restarted on loop. By adding `wait $ovs_pid` at the end of the script, the ovs-vswitchd 
container will be running for as long as the service is. On the code you will also find a trap command 
added to get the exit code of the ovs-vswitchd service if the script is finished.

The [code](https://github.com/openstack-k8s-operators/ovn-operator/commit/f93b2c1f0849196ec9351cc413cc1e28cd9479db)
added to `./templates/ovncontroller/bin/start-vswitchd.sh` is the following:

```bash
#...

# It's safe to start vswitchd now. The stderr and stdout are redirected since
# the command needs to be in the background for the script to keep on running.
/usr/sbin/ovs-vswitchd --pidfile --mlockall > /dev/stdout 2>&1 &
ovs_pid=$!

# This should never end up being stale since we have ovsVswitchdReadinessProbe
# and ovsVswitchdLivenessProbe
if [ ! -f /var/run/openvswitch/ovs-vswitchd.pid ]; then
    sleep 1
fi

# ...
# Unchanged code here handling the flow restoration
# ...

# Block script from exiting unless ovs process ends, otherwise k8s will
# restart the container again in loop.
trap "exit_rc=$?; echo ovs-vswitchd exited with rc $exit_rc; exit $exit_rc" EXIT
wait $ovs_pid
```

There is one chunk of the code not mentioned yet, the __if__ condition that is after the ovs_pid
variable assignation. It was added to make sure the rest of the script did not run before the
ovs-vswitchd service was active and had all the init commands finished, but it _is_ an arbitrary value.
The pod would fail with this change, showing the following trace on the logs:

```bash
2025-04-04T10:27:24Z|00045|connmgr|INFO|br-int<->unix#11: sending NXTTMFC_ALREADY_MAPPED error reply to NXT_TLV_TABLE_MOD message
OFPT_ERROR (OF1.4) (xid=0x2): NXTTMFC_ALREADY_MAPPED
NXT_TLV_TABLE_MOD (OF1.4) (xid=0x2):
 ADD mapping table:
  class  type  length  match field
 ------  ----  ------  --------------
  0x102  0x80       4  tun_metadata0
-----------------------------
+ cleanup_flows_backup
+ rc_code=1
+ rm -f /var/lib/openvswitch/flows-script
+ rm -rf /var/lib/openvswitch/saved-flows
+ echo 'Exited with rc 1'
Exited with rc 1
```

One idea was to play with the sleep value by setting it lower (0.1, 0.2...), but that would not work — if you
didn't wait long enough, there would be a chance that br-int was still not created, and the 
script would also fail when trying to apply the restore flows. For more context on restoring flows, check
the [previous entry of the blog](/posts/2025-04-15-fun-with-ovs-vswitchd-i/). After unsuccessfully
looking for a logical statement that could be used to know when to continue running the script, 
the best decision was to directly ask OVN folks on their opinion on this problem. And that was the key,
because it seemed this is actually a problem in __ovn-controller, which is not able to handle the 
`--ovn-restore-wait` flag on it's own__ when the `--detach` flag is not present.
So we arrived to an _dead end_ here, a workaround for this is needed.

## The second try 
Not using `--detach` was discarded at this point, but luckily Yatin (one of the ovn-operator maintainers)
quickly suggested a second option (thanks!): It seems like the ovs-vswitchd service supports the
`--log-file` flag, which ensures logs are being stored on a file of the system. Therefore the problem
now transformed into making sure the logs from the file are being echoed into the standard output:

```sh
# We need to use --log-file since --detach disables all logging explicitly.
# Once https://issues.redhat.com/browse/FDP-1292 is fixed we will be able to
# use system logs only.
/usr/sbin/ovs-vswitchd --pidfile --mlockall --detach --log-file

# ...
# Unchanged code here handling the flow restoration
# ...

tail -f /var/log/openvswitch/ovs-vswitchd.log
```

This will generate an extra file is generated in the container, which is something to be avoided when possible. __But it works!__


### Testing
To make sure this solutions were working, it was not only important to check that the logs
did appear, but also that the process of flow restoration was not broken. Therefore the 
solutions were tested on a [CRC environment](https://github.com/crc-org/crc) 
where the podified Openstack environment was running (deployed using [install_yamls](https://github.com/openstack-k8s-operators/install_yamls)). We use this to create a more developer friendly RHOSO (Red Hat Services on Openshift) environment.
For this specific scenario, the environment needed to have:
- __At least one EDPM (External Data Plane Management) node__ serving as a compute node.
- __An Openstack deployed VM running on the EDPM node being pinged__ to test possible packet loss.
- The Openstack environment needs to have __centralized FIPs__ (Floating IPs) in order to ensure
that the packets from the ping are going through the controller node, and therefore through the ovs-vswitchd container.

The VM can be easily deployed using `install_yamls`, using `make edpm_deploy_instance` from the devsetup MakeFile.

In order to make the OSP environment have centralized FIPs, my way to do it on a podified env was to modify the 
Openstack Control Plane CR `oc edit oscp` and adding this configuration on the Neutron section.
The change modifies the `neutron.conf` that is then used by the Neutron service (which will configure OVN):

```yaml
neutron:
  template:
    customServiceConfig: |
      [DEFAULT]
      debug=true
      [ovn]
      enable_distributed_floating_ip=false
```

__There was no significant ping loss when testing the different approaches__, and the
amount of packet loss was the same whether the change was applied or not, so it did not
cause a regression over previous versions.

### Conclusion

There are several takeaways from this issue. One of them is that our first solution was really focused
on not using `--detach`, but the final solution was not to get rid of it, but to use further flags
to be able to access the logs. It's important how we frame the problems in order to find an optimal solution.
In this case, there was a considerable amount of time spent on a solution here that never saw the light.

The current solution to the might not be perfect, but it's quite good and easily understandable,
so it could be that the best idea would have been to start directly with that approach. 
At the same time, I learnt many new things through the experience of debugging this issue, and I got
to find a bug in core OVN! So it left a bit of a bittersweet feel on me :-)

Until next time! o/

#### References
1. OVN Architecture: https://man7.org/linux/man-pages/man7/ovn-architecture.7.html
2. OVN `--ovn-restore-wait` issue in FDP: [https://issues.redhat.com/browse/FDP-1292](https://issues.redhat.com/browse/FDP-1292)
3. [Full PR Discussion](https://github.com/openstack-k8s-operators/ovn-operator/pull/422) for the curious.