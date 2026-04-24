main.floors.M16=
{
    "floorId": "M16",
    "title": "心境 M16",
    "name": "心境 M16",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "05.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 10000000000000,
    "defaultGround": 1902,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,4": [
            {
                "type": "if",
                "condition": "(flag:heart13==0)",
                "true": [
                    "纳可尝试跳过音未神的残像以达成胜利。\n但这显然是不现实的。"
                ],
                "false": [
                    {
                        "type": "setCurtain",
                        "color": [
                            255,
                            255,
                            255,
                            1
                        ],
                        "time": 1000,
                        "keep": true
                    },
                    {
                        "type": "if",
                        "condition": "(status:atk>status:def)",
                        "true": [
                            {
                                "type": "if",
                                "condition": "(flag:xun==0)",
                                "true": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "10000"
                                    },
                                    {
                                        "type": "win",
                                        "reason": "十三心境 - 攻"
                                    }
                                ],
                                "false": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "10000"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "flag:xun"
                                    },
                                    {
                                        "type": "win",
                                        "reason": "十三心境 - 攻"
                                    }
                                ]
                            }
                        ],
                        "false": [
                            {
                                "type": "if",
                                "condition": "(flag:xun==0)",
                                "true": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "10000"
                                    },
                                    {
                                        "type": "win",
                                        "reason": "十三心境 - 防"
                                    }
                                ],
                                "false": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "10000"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "flag:xun"
                                    },
                                    {
                                        "type": "win",
                                        "reason": "十三心境 - 防"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "6,7": {
            "floorId": ":before",
            "stair": "upFloor"
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
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,1901,1901,1901,1901,1901,  4,  4,  4,  4],
    [  4,  4,  4,  4,1901,  0,2029,  0,1901,  4,  4,  4,  4],
    [  4,  4,  4,  4,1901,1017,  0,1018,1901,  4,  4,  4,  4],
    [  4,  4,  4,  4,1901,  0, 88,  0,1901,  4,  4,  4,  4],
    [  4,  4,  4,  4,1901,1901,1901,1901,1901,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}