main.floors.MT605=
{
    "floorId": "MT605",
    "title": "605 层",
    "name": "605 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "10.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 50000000000,
    "defaultGround": 906,
    "bgm": "33.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,0": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得6把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:605f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:605f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得3把绿钥匙、1000京生命",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:605f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "1000e16"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:605f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "3"
                            }
                        ]
                    },
                    {
                        "text": "获得2000京生命",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:605f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "2000e16"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:605f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "6"
                            }
                        ]
                    },
                    {
                        "text": "离去…",
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
        "11,1": {
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
    [908,908,908,908,908,170724,985,170724,908,908,908,908,908],
    [908,1011,  0,908, 21,908,1609,638,  0,908,644, 87,908],
    [908,908,1607,908,  0,908,  0,908,640, 81,1604,908,908],
    [908,638,  0,1606,1010,1605, 22,  0, 16,908,  0, 22,908],
    [908,908, 81,908,908,908,908,908,908,908,908, 83,908],
    [908,1010,  0,908,642,908,1010,908,643,  0,908,640,908],
    [908,908,1605,908,1608,908, 15,908,908,1613,908,1603,908],
    [908, 21,  0, 21,  0,1602,  0,1604,1010,639,1610,  0,908],
    [908,1603,908,908,908,908, 50,908,908, 82,908,1603,908],
    [908,  0,1600,  0,1602, 15,1605,908,1011,  0,908, 21,908],
    [908,1015,  0,908,640,908,  0,908,1600,908,908, 16,908],
    [908, 88,  0,1604,  0, 81,1606,1010,  0,645,1602,639,908],
    [908,908,908,908,908,908,908,908,908,908,908,908,908]
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