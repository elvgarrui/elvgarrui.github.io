+++
title = 'Fun with ovs-vswitchd I: Splitting the ovs-ctl reload command to allow flow restoration'
date = 2025-04-15T10:36:12+01:00
lastmodified = ""
author = "Elvira"
license = ""
license_url = ""
cover = ""
math = false  
draft = false
+++

When we changed from classic Openstack deployment to Openstack with an Openshift Control plane (referred as RHOSO at Red Hat), we used to have a problem with openvswitch updates. The packet loss was not acceptable at all.

The reason behind this is that the ovs-ctl reload has a flow-restoration process that would reduce the unavailability of connectivity to a bare minimum. *However*, things changed when we started using a control plane built on top of Openshift. Now, we are updating OVS on **pods** instead of restarting plain processes inside a container or a host. Because of how the kubernetes/openshift lifecycle works, this meant that the whole containers and its replicas need to be torn down and recreated from zero - which means that we could not do this just with one command, so... we cannot use ovs-ctl reload anymore :(

The process of the reload is now divided in several parts. For some context, I will explain the environment we are working with. The ovn-operator has three different controllers, and each controller controls a Custom Resource (CR) and creates DaemonSets that will control the pods created from said CRs. In this case, we will look at OVNController CR, which has two different pods: ovn-controller and **ovn-controller-ovs**, the one we will mostly focus on. The ovn-controller-ovs pod has two different containers: ovsdb-server and ovs-vswitchd. Openvswitch process runs in **ovs-vswitchd**.

The new steps to perform this task in a podified environment are:

First, when the pod gets deleted, we want to **gracefully stop openvswitch on the ovs-vswitchd container and save the flows**. This includes making sure there were no leftovers from previous runs by deleting the flow restoration folder (if exists), and then create that folder with the flows from the current run. We want to use a directory that's on a separate **volume** (in this case, hostpath volume), since no storage will remain on pods in between runs by their definition.

If ovsdb-server container finishes before ovs-vswitchd container, the process will fail, so there was a need to add a **mechanism that ensures ovsdb-server will keep on running until ovs-vswitchd ends**. A perfect moment for implementing a simple **semaphore**! The last thing to do before finally stopping ovs is to create a file that will be monitored by the stop script of ovsdb-server, serving as a starting point for that script to run. For anyone curious enough to look at the codebase, everything up until that is handled by `./templates/ovncontroller/bin/stop-vswitchd.sh` on the ovn-operator.

Now, in `./templates/ovncontroller/bin/stop-ovsdb-server.sh`, the script **waits for the file created by stopping vswitchd-container, cleans it up, and then it can stop the ovsdb-server process** safely. The semaphore file is saved on the volume where saved flows are also stored, and both containers have it mounted and can read and write information from it freely. Because the file could persist in case there's any problem and the ovs-vswitchd server is forcefully stopped - and if something bad can happen, it will eventually happen - in the ovsdb-server start script we also remove said semaphore file, just to make sure there is no chance of it existing because of some forceful end of the environment.

The **ovs-vswitchd container waits for ovsdb-server container to start**, so once ovsdb-server is started, the last part of the reload begins. It is now the time for **loading the flows saved on the shared volume**. For that to happen, encap IP needs to be configured and **the flag `flow-restore-wait=true` must be set**. This is done to avoid ovs from flushing the datapath flows. The way to restore the flows is to first start the ovs-vswitchd process, with --detach to run this on the background, since otherwise the script will be stuck here and no flows will ever be restored (this will pose a new big problem as we will see later!). And with this we are ready to restore them. The trap command you can see during the flow restoration is meant to delete the saved flows folder in case anything fails.

It is **important to not have any leftovers from the procedure** or we could cause an inconsistency in the system! Once restoration is finished, we erase the folder and unset the `flow-restore-wait` flag to inform the ovs-vswitchd server that the flow restoration is completed and it can now proceed normally. The last line with sleep infinity will keep the container from terminating when the script gets to the end. All of this happens in `./templates/ovncontroller/bin/start-vswitchd.sh`

Note all of these scripts have `set -ex` as flags because we want them to **fail completely if one command exits unsuccesfully**, and as many logs as possible for a better debugging (when we have complex environments, logs are a lifesaver!) :)

### Remaining issues
As you read before, there is still one problem derivating from this new system. `--detach`, as noted on their [official documentation](https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.8.html):
> --detach
>
>              Runs  ovs-vswitchd  as a background process.  The process forks,
>              and in the child it starts a new session,  closes  the  standard
>              file descriptors (which has the side effect of disabling logging
>              to  the  console)...

This means that **we won't have any logs** of vswitchd when we do `oc logs -c ovs-vswitchd ovn-controller-ovs` on our control plane host. Which is troublesome if we want to understand the status of the environment. I will cover how we fix this on my next blog post, so stay around if you are interested! 

### Kudos

The kuttl tests on this patch were made by [Rodolfo](https://rodolfo-alonso.com/), and in general I would not have been able to do this patch without his help and the help of others from the team ([Ihar](https://ihar.dev/about/), Miro, Arnau...) I really have some awesome folks on the team!

See you next post o/

#### References
1. ovn-operator commit: [Fix gateway datapath disrupt on update](https://github.com/openstack-k8s-operators/ovn-operator/commit/303cbcdcb1cfa9d658a35dd927da4cb47e9df79f)
2. [Full PR Discussion](https://github.com/openstack-k8s-operators/ovn-operator/pull/301) for the curious
3. ovs-vswitchd documentation: [https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.8.html](https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.8.html)