main.floors.M15=
{
    "floorId": "M15",
    "title": "心境 M15",
    "name": "心境 M15",
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
        "7,6": [
            {
                "type": "choices",
                "text": "\t[转换器（蓝）,A968]你可以将手中的蓝钥匙转换为血量。",
                "choices": [
                    {
                        "text": "1蓝→9垓   剩余次数：${9-flag:627h3}",
                        "color": [
                            120,
                            154,
                            234,
                            1
                        ],
                        "need": "item:blueKey>0",
                        "condition": "flag:627h3<9",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "9e20"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "operator": "-=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:627h3",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "insert",
                                "loc": [
                                    9,
                                    8
                                ]
                            }
                        ]
                    },
                    {
                        "text": "3蓝→30垓   剩余次数：${4-flag:627h4}",
                        "color": [
                            120,
                            154,
                            234,
                            1
                        ],
                        "need": "item:blueKey>2",
                        "condition": "flag:627h4<4",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "30e20"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "operator": "-=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:627h4",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "insert",
                                "loc": [
                                    9,
                                    8
                                ]
                            }
                        ]
                    },
                    {
                        "text": "离开",
                        "action": []
                    }
                ]
            }
        ],
        "5,6": [
            {
                "type": "choices",
                "text": "\t[转换器（黄）,A967]你可以将手中的黄钥匙转换为血量。",
                "choices": [
                    {
                        "text": "1黄→3垓   剩余次数：${16-flag:627h1}",
                        "color": [
                            234,
                            216,
                            120,
                            1
                        ],
                        "need": "item:yellowKey>0",
                        "condition": "flag:627h1<16",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "3e20"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "operator": "-=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:627h1",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "insert",
                                "loc": [
                                    3,
                                    8
                                ]
                            }
                        ]
                    },
                    {
                        "text": "3黄→10垓   剩余次数：${9-flag:627h2}",
                        "color": [
                            234,
                            216,
                            120,
                            1
                        ],
                        "need": "item:yellowKey>2",
                        "condition": "flag:627h2<9",
                        "action": [
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "10e20"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "operator": "-=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:627h2",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "insert",
                                "loc": [
                                    3,
                                    8
                                ]
                            }
                        ]
                    },
                    {
                        "text": "离开",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "6,7": {
            "floorId": ":next",
            "stair": "downFloor"
        },
        "1,1": {
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
    [1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901],
    [1901, 88,  0,  0,  0,  0,  0,  0,  0,  0,1978,1487,1901],
    [1901,  0,  0,  0,1901,1901,1901,1901,1901,  0,  0,1978,1901],
    [1901,  0,  0,1901,1901,1901,1901,1901,1901,1901,  0,  0,1901],
    [1901,  0,1901,1901,1901,1901,1901,1901,1901,1901,1901,  0,1901],
    [1901,  0,1901,1901,1901,  0,2072,  0,1901,1901,1901,  0,1901],
    [1901,  0,1901,1901,1901,967,  0,968,1901,1901,1901,  0,1901],
    [1901,  0,1901,1901,1901,  0, 87,  0,1901,1901,1901,  0,1901],
    [1901,  0,1901,1901,1901,1901, 83,1901,1901,1901,1901,  0,1901],
    [1901,  0,  0,1901,1901,1901, 83,1901,1901,1901,  0,  0,1901],
    [1901,1978,  0,  0,1901,1901, 83,1901,1901,  0,  0,1978,1901],
    [1901,1487,1978,  0,  0,  0,  0,  0,  0,  0,1978,1022,1901],
    [1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901,1901]
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