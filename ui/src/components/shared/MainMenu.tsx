'use client';
import React, {useEffect, useState} from 'react';
import {AppstoreOutlined, HomeOutlined, MailOutlined, SettingOutlined} from '@ant-design/icons';
import {MenuProps, theme} from 'antd';
import {Menu} from 'antd';
import {useRouter, usePathname} from 'next/navigation';
import Link from 'next/link';

type MenuItem = Required<MenuProps>['items'][number];

const items: MenuItem[] = [
    {
        key: 'home',
        label: <Link href={"/"}>Home</Link>,
        icon: <HomeOutlined/>

    },
    {
        key: 'blog',
        label: <Link href={"/blog"}>Blog</Link>,
        icon: <MailOutlined/>,
        title: 'blog'
    },
    {
        key: 'recipes',
        label: <Link href={"/recipes"}>Recipes</Link>,
        icon: <MailOutlined/>,
        title: 'recipes'
    },
    {
        key: 'calendar',
        label: <Link href={"/calendar"}>Calendar</Link>,
        icon: <MailOutlined/>,
        title: 'calendar'
    },
    {
        type: 'divider',
    },
    {
        key: 'admin',
        label: <Link href={"/admin"}>Admin</Link>,
        icon: <SettingOutlined/>,
        title: 'admin'
    },
];

const MainMenu: React.FC = () => {
    const {
        token: {colorBgContainer, borderRadiusLG},
    } = theme.useToken();
    const pathname = usePathname();
    const [selectedKey, setSelectedKey] = useState("home");

    // const router = useRouter();
    // const onClick: MenuProps['onClick'] = (e) => {
    //     router.push(e.key);
    // };
    useEffect(() => {
        let keyName = pathname;
        if (keyName.startsWith(('/')))
            keyName = keyName.substring(1);
        // @ts-ignore
        let foundItem = items.find((item) => keyName == item.key);
        if (foundItem !== undefined)
            { // @ts-ignore
                setSelectedKey(foundItem.key || 'home')
            }
        setSelectedKey('home');
        // if(pathname.startsWith())
    }, [pathname]);
    return (
        <Menu
            theme="dark"
            mode="inline"
            items={items}
            key={selectedKey}
        />
    );
};

export default MainMenu;