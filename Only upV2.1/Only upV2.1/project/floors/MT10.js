main.floors.MT10=
{
    "floorId": "MT10",
    "title": "萤火幽墟 - 10",
    "name": "萤火幽墟 - 10",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "2.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 100,
    "defaultGround": 300,
    "bgm": "1.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,0": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,12": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT10_6_10",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "setValue",
                "name": "item:I573",
                "operator": "+=",
                "value": "Math.round(status:hp/100)"
            },
            {
                "type": "choices",
                "text": "成绩记录点 - 1\n计分方式：血点数*1e9+剩余生命",
                "choices": [
                    {
                        "text": "记录成绩",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "item:I573*1e9"
                            },
                            {
                                "type": "if",
                                "condition": "(item:I581==1)",
                                "true": [
                                    {
                                        "type": "win",
                                        "reason": "Easy - 萤火幽墟"
                                    }
                                ],
                                "false": [
                                    {
                                        "type": "if",
                                        "condition": "(item:I582==1)",
                                        "true": [
                                            {
                                                "type": "win",
                                                "reason": "Hard - 萤火幽墟"
                                            }
                                        ],
                                        "false": [
                                            {
                                                "type": "win",
                                                "reason": "Chaos - 萤火幽墟"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "text": "继续游戏",
                        "action": []
                    }
                ]
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "6,10": {
            "0": {
                "condition": "flag:door_MT10_6_10==1",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT10_6_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "6,11": {
            "0": {
                "condition": "flag:door_MT10_6_10==1",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT10_6_10",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [360461,360462,360463,150,150,150, 88,150,150,150,360461,360462,360463],
    [360477,360478,150,150,150,1013,  0,1014,150,150,150,360478,360479],
    [265,150,150,150,621,333,150,333,621,150,150,150,265],
    [150,150,150,621,  0,150,150,150,  0,621,150,150,150],
    [370194,370195,370201,334,150,150,150,150,150,334,370200,370194,370195],
    [370202,370203,370209,619,150,150,1016,150,150,619,370208,370202,370203],
    [370194,370195,370201,267,150,620,  0,619,150,267,370200,370194,370195],
    [370202,370203,370209,  0,267,  0,270,  0,267,  0,370208,370202,370203],
    [370194,370195,370201,150,150,619,  0,620,150,150,370200,370194,370195],
    [370202,370203,370209,370201,150,150,1019,150,150,370200,370208,370202,370203],
    [370194,370195,370194,370195,370201,150, 85,150,370200,370203,370195,370194,370195],
    [370202,370203,370202,370203,370209,150, 85,150,370208,370195,370203,370202,370203],
    [370194,370195,370194,370195,370201,360654, 87,360654,370200,370203,370195,370194,370195]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [370200,370201,  0,  0,  0,  0,  0,  0,  0,  0,  0,370200,370201],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,370200,  0,  0,  0,  0,  0,  0,  0,370201,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,360638,  0,360638,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}