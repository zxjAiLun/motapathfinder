main.floors.MT328=
{
    "floorId": "MT328",
    "title": "328 层",
    "name": "328 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2000000,
    "defaultGround": 917,
    "bgm": "20.mp3",
    "firstArrive": [
        "系统提示：本层的传送术式规则，与以往不同，\n会将角色传送至顺时针方向的下一个术式，\n但需要支付\r[aqua]2000亿生命\r！"
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "1,8": [
            {
                "type": "choices",
                "text": "支付2000亿生命：",
                "choices": [
                    {
                        "text": "传送",
                        "action": [
                            {
                                "type": "if",
                                "condition": "(status:hp>2e11)",
                                "true": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "-=",
                                        "value": "2e11"
                                    },
                                    {
                                        "type": "changeFloor",
                                        "floorId": "MT328",
                                        "loc": [
                                            1,
                                            1
                                        ],
                                        "direction": "down"
                                    }
                                ],
                                "false": [
                                    "生命不足。"
                                ]
                            }
                        ]
                    },
                    {
                        "text": "离去",
                        "action": []
                    }
                ]
            }
        ],
        "11,2": [
            {
                "type": "choices",
                "text": "支付2000亿生命：",
                "choices": [
                    {
                        "text": "传送",
                        "action": [
                            {
                                "type": "if",
                                "condition": "(status:hp>2e11)",
                                "true": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "-=",
                                        "value": "2e11"
                                    },
                                    {
                                        "type": "changeFloor",
                                        "floorId": "MT328",
                                        "loc": [
                                            11,
                                            8
                                        ],
                                        "direction": "down"
                                    }
                                ],
                                "false": [
                                    "生命不足。"
                                ]
                            }
                        ]
                    },
                    {
                        "text": "离去",
                        "action": []
                    }
                ]
            }
        ],
        "11,8": [
            {
                "type": "choices",
                "text": "支付2000亿生命：",
                "choices": [
                    {
                        "text": "传送",
                        "action": [
                            {
                                "type": "if",
                                "condition": "(status:hp>2e11)",
                                "true": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "-=",
                                        "value": "2e11"
                                    },
                                    {
                                        "type": "changeFloor",
                                        "floorId": "MT328",
                                        "loc": [
                                            1,
                                            8
                                        ],
                                        "direction": "down"
                                    }
                                ],
                                "false": [
                                    "生命不足。"
                                ]
                            }
                        ]
                    },
                    {
                        "text": "离去",
                        "action": []
                    }
                ]
            }
        ],
        "1,1": [
            {
                "type": "choices",
                "text": "支付2000亿生命：",
                "choices": [
                    {
                        "text": "传送",
                        "action": [
                            {
                                "type": "if",
                                "condition": "(status:hp>2e11)",
                                "true": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "-=",
                                        "value": "2e11"
                                    },
                                    {
                                        "type": "changeFloor",
                                        "floorId": "MT328",
                                        "loc": [
                                            11,
                                            2
                                        ],
                                        "direction": "down"
                                    }
                                ],
                                "false": [
                                    "生命不足。"
                                ]
                            }
                        ]
                    },
                    {
                        "text": "离去",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [151,151,151,151,151,151,151,151,151,151,151,151,151],
    [151,104,151,151,584,151,151,639,619, 81, 60,151,151],
    [151,  0,1099,619,1096,151,151,151,1006,151,637,104,151],
    [151,620,151,151, 83,151,151,151,151,151,151,151,151],
    [151,1100,151,151,619,151,151,151,151, 21,151,636,151],
    [151,587,1095,  0,585, 82,579,572, 82,  0,1101,621,151],
    [151,151,151, 22,  0,151,151,151,151,151,151, 16,151],
    [151,151,637,  0,151,151,151,151,584,151,619,  0,151],
    [151,104,  0, 21, 16,579,572,1096,619,1099,  0,104,151],
    [151,151,1096,151,151,151,151,151,151,151,1100,151,151],
    [151,  0,621,151,151,151,587,151,251379,251380,585, 60,151],
    [151, 88,  0,1095,619,1098, 22,1103,  0,1102, 60, 87,151],
    [151,151,151,151,151,151,151,151,151,151,151,151,151]
],
    "bgmap": [

],
    "fgmap": [
    [251357,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,251371,251372,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}